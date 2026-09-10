//
// For guidance on how to create routes see:
// https://prototype-kit.service.gov.uk/docs/create-routes
//

const path = require('path')
const govukPrototypeKit = require('govuk-prototype-kit')
const router = govukPrototypeKit.requests.setupRouter()

// Serve Universal Viewer built assets (CSS, UMD bundle, and lazy-loaded chunks)
// from the installed npm package. Available at /universalviewer/...
govukPrototypeKit.requests.serveDirectory(
  '/universalviewer',
  path.join(__dirname, '..', 'node_modules', 'universalviewer', 'dist')
)

// Add your routes here
