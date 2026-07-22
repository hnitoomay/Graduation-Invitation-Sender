const { createApp } = require("./app");
const { buildServerConfig } = require("./config");

const config = buildServerConfig();
const { app } = createApp();

app.listen(config.PORT, config.HOST, () => {
  console.log(`Server listening on http://${config.HOST}:${config.PORT}`);
});
