const fs = require('fs')
const path = require('path')

try {
  fs.statSync('./db.sqlite3')
} catch (_){
  fs.writeFileSync('./db.sqlite3', fs.readFileSync(path.join(__dirname, 'db.empty.sqlite3')))
}

const knex = require('knex')({
  client: 'sqlite3',
  connection: {
    filename: './db.sqlite3'
  },
  useNullAsDefault: true
})

module.exports = knex