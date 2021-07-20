const ejs = require('ejs')
const fs = require('fs').promises
const path = require('path')

const CSS_PATH = path.join(__dirname, 'build/templating', (process.env.NODE_ENV == 'production'? 'compiled.purged.min.css' : 'compiled.min.css'))// __dirname + '/build/templating/' + 

async function renderTemplate(meta, out_file_name){
  try {
    await fs.access(CSS_PATH, require('fs').constants.F_OK)
  } catch (e){
    console.log("Please run `npm run " + (process.env.NODE_ENV == 'production'? "build.css" : "dev.build.css") + "` first.")
    return
  }

  const css = "<style type='text/css'>" + await fs.readFile(CSS_PATH, "utf-8") + "</style>"
  const tweets = meta.tweetIds.map(tweetId => { 
    const tweet = meta.tweet_data[tweetId]
    return {
      content: tweet?.full_text,
      date: tweet?.created_at,
      mentions: tweet?.entities.user_mentions,
      display_text_range: tweet?.display_text_range,
      id: tweetId,
      is_available: tweet != null
  }})
  const user = {
    handle: meta.user.screen_name,
    name: meta.user.name,
    created_at: meta.user.created_at,
    id: meta.user.id_str
  }
  await fs.writeFile('./output/' + out_file_name + '/' + out_file_name + '.html', await ejs.render(await fs.readFile(path.join(__dirname, 'templating/template.ejs'), "utf-8"), { css: css, tweets: tweets, user: user }, { async: true }))
  console.log("html output")
}

module.exports = {
  renderTemplate
}