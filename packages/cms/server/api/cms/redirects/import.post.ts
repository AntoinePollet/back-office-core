/** Import en lot : { text } (« ancienne ; nouvelle » par ligne) ou { rules: [{ from, to, status? }] } ; options status, replace, dryRun. */
export default defineEventHandler(event => importRedirects(event))
