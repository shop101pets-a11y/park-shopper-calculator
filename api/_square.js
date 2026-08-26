const SQUARE_VERSION = '2024-08-21';

function getSquareConfig() {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  const environment = process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  const baseUrl = environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';

  return { accessToken, locationId, environment, baseUrl };
}

module.exports = { SQUARE_VERSION, getSquareConfig };
