import { Config } from "@remotion/cli/config";

Config.setEntryPoint("./video/index.ts");
Config.setPublicDir("./video/public");
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
