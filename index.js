const config = require('./config.json')
const puppeteer = require('puppeteer-core')
const fs = require('fs').promises
const fsSync = require('fs')
const _ = require('lodash')
const axios = require('axios').default
const Promise = require('bluebird')

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
  const upperTweetLinks = await Promise.all(upperTweets.map(async article => (await (await article.getProperty('href')).jsonValue())))

  await page.waitForSelector('section > div > div')
  await page.waitForSelector('section > div > div')
  
  const isThreadSeparatorDetected = await page.evaluate(() => {
    return Array.from(document.querySelector('section > div > div').querySelectorAll(':scope > div')).filter(e => e.textContent == "").length >= 2
  })

  console.log(isThreadSeparatorDetected)

  let upperLimitIdx = -1
  upperTweetLinks.forEach((link, i) => (!link.startsWith('https://twitter.com/' + username) && upperLimitIdx == -1)? upperLimitIdx = i : null)
  const upperTweetIds = upperTweetLinks.filter((_, i) => !(upperLimitIdx != -1 && i >= upperLimitIdx)).map(link => link.split('/')[5])

  tweetIds.push(splitParentUrl[5])
  tweetIds.push(...upperTweetIds)

  // If the upper tweets haven't encountered a thread-breaking filter and is not a single tweet, continue grabbing the lower tweets.
  if(upperLimitIdx == -1 && upperTweetIds.length != 0 & !isThreadSeparatorDetected){
    const grabLowerTweetIds = (debug = false) => new Promise(async resolve => {
      let tweetIds = []
  
      const finish = async () => {
        console.log('thread seperator found.')
        await page.evaluate(() => {
          clearInterval(window.threadScroller)
          window.threadRefreshObserver.disconnect()
        })
        await new Promise(res => setTimeout(res, 500)) // Wait for all link appends to finish.
        if (debug) console.log('scroller stopped')
        tweetIds = _.uniq(tweetIds).map(link => link.split('/')[3]).sort()
        resolve(tweetIds)
      }
  
      await page.exposeFunction('sendLinkToScrolledThread', async link => {
        if(link.startsWith('/' + username)){
          if (debug) console.log(link)
          tweetIds.push(link)
        }
      })

      await page.exposeFunction('finishScrollThread', async _ => {
        await finish()
      })
  
      await page.evaluate(() => {
        const threadContainer = document.querySelector('section > div > div')
        window.finishing = false
        window.threadRefreshObserver = new MutationObserver(muts => {
          for (const mut of muts) {
            if (mut.addedNodes.length >= 1) {
              if(mut.addedNodes[0].textContent != ""){ // Stop if detected a thread seperator.
                sendLinkToScrolledThread(mut.addedNodes[0].querySelector('article > div > div > div > div:last-child > div:last-child > div:first-child > div > div > div:first-child > a:last-child').getAttribute('href'))
              } else if(!window.finising) {
                window.finishing = true
                finishScrollThread()
              }
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
  }

  console.log(tweetIds)
  meta.tweetIds = tweetIds
  meta.scrape_ids_stop = Date.now()

  const grabTweetDataFromApi = async (tweetIds, debug = false) => {
    if (debug) console.log('fetching tweet data from api')

    let tweetIdsChunks = [tweetIds]
    if (tweetIds.length > 95) {
      tweetIdsChunks = _.chunk(tweetIds, 5)
    }

    return _.merge(...(await Promise.allSettled(tweetIdsChunks.map(tweetIdChunks =>
      axios.get('https://api.twitter.com/1.1/statuses/lookup.json?id=' + encodeURIComponent(tweetIdChunks.join(',')) + "&tweet_mode=extended&map=true&include_ext_alt_text=true&trim_user=true",
        { headers: { 'Authorization': 'Bearer ' + config.twitterApiToken } }).then(res => res.data.id)
    ))).map(promise => promise._settledValueField))
  }

  meta.grab_tweet_data_start = Date.now()
  const tweetData = await grabTweetDataFromApi(tweetIds, true)
  meta.grab_tweet_data_end = Date.now()

  const mediaUrls = Object.values(tweetData).map(tweet => {
    try {
      if (tweet.extended_entities.media.length > 0) {
        return tweet.extended_entities.media.map(media => {
          if (media.type == 'video') { // Video
            let largestBitrate = 0
            let laregestBitrateUrl = ""
            for(mediaWithBitrate of media.video_info.variants){
              if(mediaWithBitrate.bitrate && mediaWithBitrate.bitrate >= largestBitrate){
                largestBitrate = mediaWithBitrate.bitrate
                laregestBitrateUrl = mediaWithBitrate.url
              }
            }
            return { id: media.id_str, url: laregestBitrateUrl }
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

  meta.user = await axios.get('https://api.twitter.com/1.1/users/show.json?screen_name=' + encodeURIComponent(username),
   { headers: { 'Authorization': 'Bearer ' + config.twitterApiToken } }).then(res => res.data)

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
    await Promise.map(mediaUrls, media => axios.get(media.url, { responseType: 'stream' }).then(res => {
      const urlSplit = (new URL(media.url)).pathname.split('/')
      const savePath = 'output/' + outputFileName + '/media/' + media.id + '-' + urlSplit[urlSplit.length - 1]
      res.data.pipe(fsSync.createWriteStream(savePath))
      return new Promise((resolve, reject) => {
        res.data.on('end', resolve)
        res.data.on('error', reject)
      })
    }), { concurrency: 6 })
  }
  console.log('media downloaded')

  await browser.close()
}

main()