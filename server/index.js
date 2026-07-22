const { createApp } = require("./app");
const { PORT, HOST } = require("./config");

const { app, shutdown } = createApp();

const server = app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});

async function stop() {
  await shutdown();
  server.close(() => process.exit(0));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
