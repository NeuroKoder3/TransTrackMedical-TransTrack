import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";

export default [
  // =========================================================================
  // Frontend (React) configuration
  // =========================================================================
  {
    files: [
      "src/components/**/*.{js,mjs,cjs,jsx}",
      "src/pages/**/*.{js,mjs,cjs,jsx}",
      "src/Layout.jsx",
    ],
    ignores: ["src/lib/**/*", "src/components/ui/**/*"],
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      "no-unused-vars": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["cmdk-input-wrapper", "toast-close"] },
      ],
      "react-hooks/rules-of-hooks": "error",
    },
  },

  // =========================================================================
  // Backend (Electron main process) configuration
  // =========================================================================
  {
    files: [
      "electron/**/*.cjs",
    ],
    ...pluginJs.configs.recommended,
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "commonjs",
      },
    },
    rules: {
      // Disallow bare console.log/warn/error in production code.
      // Use the structured logger (electron/services/logger.cjs) instead.
      "no-console": "warn",
      "no-console": ["warn", { allow: [] }],

      // Catch variables that are declared but never read
      "no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],

      // Enforce consistent error handling
      "no-throw-literal": "error",

      // Prevent accidental assignments in conditions
      "no-cond-assign": ["error", "always"],

      // Disallow eval() — security-critical for HIPAA compliance
      "no-eval": "error",
      "no-implied-eval": "error",

      // Require strict equality
      "eqeqeq": ["error", "always"],

      // Disallow with statements
      "no-with": "error",

      // Prevent duplicate keys in objects
      "no-dupe-keys": "error",

      // No unreachable code
      "no-unreachable": "error",

      // Require valid typeof comparisons
      "valid-typeof": "error",
    },
  },
];
