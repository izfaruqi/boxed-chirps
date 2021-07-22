const knex = require('knex')({
  client: 'sqlite3',
  connection: {
    filename: './db.sqlite3'
  },
  useNullAsDefault: true
})

module.exports = knex