# Listy

Listy is an anime-inspired personal quest tracker for iOS, Android, and the browser. The Expo React Native app shares one interface across all three platforms. Tasks are saved on the device first and can sync directly to a private GitHub repository as a human-readable Markdown file.

## Features

- Add, complete, filter, and delete quests; group them by category and set priorities and due dates.
- Track a daily completion streak and view a GitHub-style 13-week activity grid.
- Work offline: your tasks remain on your device; use **Sync now** after reconnecting if an offline change did not sync.
- Keep your own data in a private GitHub repository, with conflict protection when the remote Markdown file has changed.
- Store mobile access tokens in the iOS Keychain or Android Keystore. In a browser, the token is kept in session storage and cleared when that browser session ends.

## Run locally

Install Node.js, then:

```sh
npm install
npm run start
```

Use the Expo development menu to open the app on a device or simulator. For the browser client:

```sh
npm run web
```

To create a static browser build:

```sh
npm run web:build
```

## Connect a private GitHub repository

1. Create a private repository in your GitHub account.
2. Create a fine-grained personal access token limited to that repository, with **Contents: read and write** permission.
3. In Listy's Settings, enter the repository owner, repository name, and token. The Markdown path defaults to `tasks.md`.
4. Choose **Connect & sync**. Listy creates the Markdown file if it does not exist; otherwise, it brings the existing tasks into the app.

Listy sends requests directly from the client to the GitHub API. It does not use a Listy server or store your GitHub token in the repository. Treat the token like a password and revoke it from GitHub when you no longer need it. A browser token is available to scripts running in that browser origin, so use the browser client only on a trusted deployment.

## Markdown format

The configured file contains ordinary Markdown checkboxes. Listy stores task identifiers, dates, priority, and category in an HTML comment on each task line, so the file remains readable and can also be edited in GitHub or any Markdown editor.

## Build native apps

The project is configured for Expo's native iOS and Android build workflows. To create an installable Android APK for testing:

```sh
npx eas-cli@latest build --platform android --profile preview
```

The `preview` profile builds an APK for direct installation. The `production` profile builds an Android App Bundle for Play Store distribution. EAS manages the Android signing credentials; native build outputs are not committed to this repository.
