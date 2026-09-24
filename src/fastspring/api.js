const axios = require('axios');

// Preconfigured axios instance for all FastSpring REST API calls.
// Credentials are Basic Auth: API username + API password.
//
// WHERE TO GET THESE (FS_API_USERNAME / FS_API_PASSWORD):
//   FastSpring Dashboard → Integrations → API Credentials
//   (https://app.fastspring.com/settings/api) → "Create Credentials".
//   The password is shown only once at creation time. Set both in your .env
//   file (never hardcode them here). See .env.example for the full list.
const fsApi = axios.create({
  baseURL: 'https://api.fastspring.com',
  auth: {
    username: process.env.FS_API_USERNAME,
    password: process.env.FS_API_PASSWORD,
  },
  headers: { 'Content-Type': 'application/json' },
});

module.exports = fsApi;
