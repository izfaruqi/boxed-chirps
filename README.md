# boxed-chirps
A small utility to archive Twitter threads into machine-friendly jsons and human-friendly pdfs (not yet implemented).

To use:

1. Make sure you have Google Chrome installed.

2. Rename `config.json.example` to `config.json` and fill in your Twitter API bearer token (free plan is enough).

3. Run
```
node index.js https://twitter.com/username/status/1234567890
```

4. The output will be under the `output` folder.