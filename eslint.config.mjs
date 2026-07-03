// ioBroker eslint template configuration file for js and ts files
// Please note that esm or react based modules need additional modules loaded.
import config from "@iobroker/eslint-config";
import { fileURLToPath } from "node:url";

const tsconfigTestPath = fileURLToPath(
  new URL("./tsconfig.test.json", import.meta.url),
);
const tsconfigAdminPath = fileURLToPath(
  new URL("./src-admin/tsconfig.json", import.meta.url),
);

export default [
  ...config,
  {
    // specify files to exclude from linting here
    ignores: [
      ".vscode/",
      "admin/assets/",
      "build/",
      "build-test/",
      "**/*.test.js",
      "test/**/*.js",
      "**/adapter-config.d.ts",
    ],
  },
  {
    files: ["test/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: tsconfigTestPath,
      },
    },
  },
  {
    files: ["src-admin/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: tsconfigAdminPath,
      },
    },
  },
  {
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-param-description": "off",
      "jsdoc/require-returns-description": "off",
      "jsdoc/require-returns-check": "off",
    },
  },
];
