const { handleApi } = require('../lib/app-handler');

module.exports = async (req, res) => {
  try {
    const pathname = req.url.split('?')[0];
    await handleApi(req, res, pathname);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: error.message || 'Server error' }));
  }
};
