const config = require('./config.json')
const puppeteer = require('puppeteer-core')
const fs = require('fs').promises
const fsSync = require('fs')
const _ = require('lodash')
const axios = require('axios').default

async function main() {
  let tweetIds = []
  const meta = {}
  meta.scrape_ids_start = Date.now()
  const parentUrl = process.argv[2]
  if (parentUrl && (parentUrl.length <= 0)) {
    console.log('no url provided')
    return
  }
  const splitParentUrl = parentUrl.split('/')
  const username = splitParentUrl[3]
  meta.url = parentUrl

  const browser = await puppeteer.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", userDataDir: './puppeteer-userdata', headless: true })
  const page = await browser.newPage()
  page.setViewport({ width: 800, height: 850 })
  page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")

  await page.goto(parentUrl)
  await page.waitForSelector('article')
  console.log("found parent tweet")

  const upperTweets = await page.$$('article > div > div > div > div:last-child > div:last-child > div:first-child > div > div > div:first-child > a:last-child')
  const upperTweetIds = await Promise.all(upperTweets.map(async article => (await (await article.getProperty('href')).jsonValue()).split('/')[5]))

  tweetIds.push(splitParentUrl[5])
  tweetIds.push(...upperTweetIds)

  const grabLowerTweetIds = (debug = false) => new Promise(async resolve => {
    let tweetIds = []

    const finish = async () => {
      await page.evaluate(() => {
        clearInterval(window.threadScroller)
        window.threadRefreshObserver.disconnect()
      })
      if (debug) console.log('scroller stopped')
      tweetIds = _.uniq(tweetIds).map(link => link.split('/')[3]).sort()
      resolve(tweetIds)
    }

    await page.exposeFunction('sendLinkToScrolledThread', async link => {
      if (!link.startsWith('/' + username)) {
        if (debug) console.log('tweet from different username found: ' + link)
        await finish()
      } else {
        if (debug) console.log(link)
        tweetIds.push(link)
      }
    })

    await page.evaluate(() => {
      const threadContainer = document.querySelector('section > div > div')
      window.threadRefreshObserver = new MutationObserver(muts => {
        for (const mut of muts) {
          if (mut.addedNodes.length >= 1) {
            sendLinkToScrolledThread(mut.addedNodes[0].querySelector('article > div > div > div > div:last-child > div:last-child > div:first-child > div > div > div:first-child > a:last-child').getAttribute('href'))
          }
        }
      })
      window.threadRefreshObserver.observe(threadContainer, { childList: true })

      window.threadScroller = setInterval(() => {
        document.scrollingElement.scrollBy(0, 75);
      }, 100)
    })
  })

  tweetIds.push(...(await grabLowerTweetIds(true)))
  console.log(tweetIds)
  meta.scrape_ids_stop = Date.now()

  const grabTweetDataFromApi = async (tweetIds, debug = false) => {
    if (debug) console.log('fetching tweet data from api')

    let tweetIdsChunks = [tweetIds]
    if (tweetIds.length > 5) {
      tweetIdsChunks = _.chunk(tweetIds, 5)
    }

    return _.merge(...(await Promise.allSettled(tweetIdsChunks.map(tweetIdChunks =>
      axios.get('https://api.twitter.com/1.1/statuses/lookup.json?id=' + encodeURIComponent(tweetIdChunks.join(',')) + "&map=true&include_ext_alt_text=true",
        { headers: { 'Authorization': 'Bearer ' + config.twitterApiToken } }).then(res => res.data.id)
    ))).map(promise => promise.status == 'fulfilled' ? promise.value : null).flat())
  }

  meta.grab_tweet_data_start = Date.now()
  const tweetData = await grabTweetDataFromApi(tweetIds, true)
  meta.grab_tweet_data_end = Date.now()

  const mediaUrls = Object.values(tweetData).map(tweet => {
    try {
      if (tweet.extended_entities.media.length > 0) {
        return tweet.extended_entities.media.map(media => {
          if (media.type == 'video') { // Video
            return { id: media.id_str, url: media.video_info.variants[media.video_info.variants.length - 1].url }
          } else { // Photo
            return { id: media.id_str, url: media.media_url + '?name=orig' }
          }
        })
      }
    } catch (e) {
      return null
    }
    return null
  }).filter(x => x != null).flat()

  meta.media = mediaUrls

  const outputFileName = username + '_' + splitParentUrl[5] + '_' + meta.scrape_ids_start

  await fs.mkdir('output/' + outputFileName)
  await fs.writeFile('output/' + outputFileName + "/" + outputFileName + '.json', JSON.stringify({
    ...meta,
    tweet_data: tweetData
  }))
  console.log('tweet data dumped to json')

  console.log(mediaUrls)

  console.log('downloading media')
  if (mediaUrls.length > 0) {
    fs.mkdir('output/' + outputFileName + '/media')
    await Promise.allSettled(mediaUrls.map(media => axios.get(media.url, { responseType: 'stream' }).then(res => {
      const urlSplit = (new URL(media.url)).pathname.split('/')
      const savePath = 'output/' + outputFileName + '/media/' + media.id + '-' + urlSplit[urlSplit.length - 1]
      res.data.pipe(fsSync.createWriteStream(savePath))
      return new Promise((res, rej) => {
        res.data.on('end', res)
        res.data.on('error', rej)
      })
    })))
  }
  console.log('media downloaded')
  await browser.close()
}

main()