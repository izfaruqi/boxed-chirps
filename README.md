# boxed-chirps
A small utility to archive Twitter threads into machine-friendly jsons and human-friendly pdfs (not yet implemented).

To use (from sources):
1. Make sure you have Google Chrome installed.
2. Run `npm install` and `npm run build.css`
3. Run `node src/index.js` for the first time to setup the config file and database.
4. Fill your Twitter API token in the config file.
5. Run `node src/index.js <full tweet url>` to start archiving! (full tweet url example: https://twitter.com/izfaruqi/status/1234567882350000)

You can use the `-nq` flag before the url to disable quote tweet fetching.