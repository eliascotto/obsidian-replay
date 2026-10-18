---
description: Validate, release, and submit Replay to the Obsidian Community directory.
---

# Release Replay

Version `1.0.0` is prepared. The plugin ID remains `replay`, the minimum Obsidian version is `1.7.2`, and mobile support remains enabled. The portable recording format is still version 1; plugin and recording-format versions are independent.

## Readiness

Verified locally on 2026-10-18 with Node.js 22.14.0:

- Clean dependency installation and all 273 automated tests pass.
- Lint has no errors and one existing warning: settings are not indexed by Obsidian 1.13+ settings search. They remain available in **Settings → Replay**.
- The production build and exact `1.0.0` release checks pass.
- Workflow YAML and embedded shell syntax pass local validation. The updated GitHub workflow still needs its first remote run.
- Earlier macOS/Obsidian 1.13.7 smoke tests are recorded in [PLAN.md](PLAN.md).

Before publishing, complete these outstanding device checks with the release assets in a separate test vault:

- [ ] Record an existing note; type, paste, undo, redo, and stop. Verify the exact initial and final text.
- [ ] Make unrecorded edits, resume, stop, and restart Obsidian. Confirm earlier history survives and recording restarts stopped.
- [ ] Record two notes independently; rename/move one and confirm its companion follows without overwriting other files.
- [ ] Play, pause, seek, step, change speed, and toggle Doomed in light and dark themes. Confirm playback leaves the note unchanged.
- [ ] Open a copied `.replay` file in another vault without its source note or local recording history.
- [ ] Run the recording, restart, playback, and sharing journey on at least one mobile device.
- [ ] Run the core recording and playback journey on Obsidian 1.7.2 to verify the declared minimum.

Record the device/version and results in [PLAN.md](PLAN.md). Automated checks do not establish device compatibility. Resolve failures before publication; do not mark unperformed checks as passed.

## Commit and push

The repository was private when preparation was checked. For this open-source submission, make `eliascotto/obsidian-replay` public in GitHub's repository settings before publishing; otherwise Obsidian cannot download its release assets. Review what will become public first. Keep GitHub Actions enabled and ensure repository or organization policies allow the workflow's declared token permissions.

Review the diff, then commit the prepared source, documentation, and metadata:

```sh
git diff --check
git add README.md manifest.json package.json package-lock.json versions.json version-bump.mjs scripts/check-release.mjs tests/release/check.test.ts .github/workflows/release.yml docs/PLAN.md docs/RELEASING.md
git commit -m "Prepare Replay 1.0.0 release"
git push origin main
```

Wait for **Node.js build** to pass in [GitHub Actions](https://github.com/eliascotto/obsidian-replay/actions). Do not commit generated `main.js`, `dist/`, or `node_modules/`.

## Create the release

Create the tag from the release commit on `main`, then push only that tag:

```sh
git tag -a 1.0.0 -m "Replay 1.0.0"
git push origin 1.0.0
```

Use exactly `1.0.0`, without a leading `v`. **Release Obsidian plugin** installs locked dependencies, runs tests/lint/build and exact-tag validation, attests the public repository's assets, and creates a **draft** release. It attaches `main.js`, `manifest.json`, and `styles.css` individually and generates release notes. It uses the built-in `GITHUB_TOKEN`; no personal access token is needed.

Open [GitHub Releases](https://github.com/eliascotto/obsidian-replay/releases), inspect the draft notes and its three attachments, and test those downloaded assets. Confirm the attached manifest says `1.0.0`. After the outstanding device checks pass, select **Publish release**; keep it a stable release rather than a prerelease. Obsidian cannot install from a draft release.

Suggested release summary:

> Record and replay the evolution of your notes. Continue recordings across sessions, explore edits with Markdown playback and Doomed highlights, and share self-contained `.replay` files. Recordings stay local and include deleted and replaced text.

If the workflow fails, inspect its logs before rerunning it. If testing requires a code change, prepare and validate a corrected release commit rather than publishing the failed build. After a release is public, use an incremented version for fixes instead of moving its tag or replacing its assets.

## Submit to Obsidian

Follow Obsidian's current [submission guide](https://docs.obsidian.md/plugins/releasing/submit-plugin) and [account setup instructions](https://docs.obsidian.md/community-directory/set-up-and-claim):

1. Sign in at [community.obsidian.md](https://community.obsidian.md) with your Obsidian account.
2. Connect the GitHub account that owns the repository.
3. Open **Plugins → New plugin** and enter `https://github.com/eliascotto/obsidian-replay`.
4. Select the owner, review the developer policies and support commitment, then submit.
5. Address the directory's automated review results and complete its publication controls. Review fixes require a new incremented GitHub release.

The directory reads the manifest from the default branch (`main`) and installs the assets from the published release matching its version. Keep both aligned. Initial submission uses the Community directory form; subsequent versions are distributed through GitHub releases without submitting the plugin again.

## Future versions

For example, prepare `1.0.1` without letting npm create a `v`-prefixed Git tag:

```sh
npm version 1.0.1 --no-git-tag-version
npm test
npm run lint
npm run build
npm run check:release -- --tag 1.0.1
```

The version script updates the manifest and version map; npm updates package and lockfile versions. Review and commit those files, push `main`, wait for CI, then create and push the exact version tag. Review and publish the resulting draft release.
