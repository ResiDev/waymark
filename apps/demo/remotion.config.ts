import { Config } from "@remotion/cli/config";

Config.setEntryPoint("./video/index.ts");
Config.setPublicDir("./video/public");
// PNG, not JPEG: JPEG softens the UI's 1px borders before the encoder ever sees them.
Config.setVideoImageFormat("png");
