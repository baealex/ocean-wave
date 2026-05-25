# Ocean Wave Deployment and Release Strategy

Updated: 2026-05-21

## 1. Deployment Principle

Ocean Wave uses an intentional manual deployment model.

The core rule is simple: deploy only when the maintainer explicitly wants to deploy.

CI passing means the code is validated. It does not mean a Docker image should be published automatically.

Agents must treat Docker image builds as deployment artifact updates. Do not trigger `BUILD IMAGE` from inferred intent, prior context, PR merge completion, CI success, or workflow maintenance work. Trigger it only when the maintainer explicitly asks to build/publish/deploy the Docker image for the current task.

## 2. Workflow Roles

### CI

- Runs validation for pushes, pull requests, and manual CI checks.
- Confirms the repository is in a buildable and testable state.
- Must not publish deployment artifacts.

### BUILD IMAGE

- Builds and pushes the Docker image.
- Must be triggered manually with GitHub Actions `Run workflow`.
- Must not run automatically after CI success.
- Must not use `push`, `workflow_run`, or scheduled triggers unless this deployment strategy is intentionally changed.

### MOBILE RELEASE

- Builds an Android APK and publishes it to GitHub Releases for trusted testers and Obtainium users.
- Must be triggered manually with GitHub Actions `Run workflow`.
- Must not run automatically after CI success.
- Must not use `push`, `workflow_run`, or scheduled triggers unless this deployment strategy is intentionally changed.
- Current mobile releases are alpha/pre-release APKs signed with the project Android release key, not Play Store builds.

## 3. Deployment Artifact Smoke Matrix

Ocean Wave has two deployment artifact surfaces. Keep their smoke checks separate;
do not add npm or npx publish smoke because this repository does not publish an
npm package as a deployment artifact.

| Artifact | Producer | Minimum smoke | Secret needed | Notes |
| --- | --- | --- | --- | --- |
| Docker server/web image `baealex/ocean-wave:latest` | Manual `BUILD IMAGE` workflow | Start the image in explicit open mode and password mode. Confirm `/api/auth/session`, `/` app shell serving, password login, and a basic GraphQL list query. | No | Local command: `SMOKE_IMAGE=baealex/ocean-wave:latest pnpm smoke:docker`. This may pull the image if it is not already present. |
| Android debug APK `app-debug.apk` | `CI` `android mobile assemble` job | Confirm Gradle produces `packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk` and GitHub Actions uploads `ocean-wave-pocket-debug-apk`. | No | This is a validation artifact, not a production release. |
| Android release-signed APK `ocean-wave-pocket-v<version_name>.apk` | Manual `MOBILE RELEASE` workflow | Confirm `app-release.apk` is copied to `dist/mobile/ocean-wave-pocket-v<version_name>.apk` and attached to the `mobile-v<version_name>` GitHub Release. | Yes, release signing secrets | Do not run this smoke locally without maintainer-provided release credentials. |

The Docker smoke still includes `OCEAN_WAVE_ALLOW_INSECURE_NO_AUTH=true` for the
open-mode startup check, then starts a second short-lived container with a
temporary password and session secret. This verifies the password gate without
using real deployment credentials.

## 4. Manual Deployment Flow

1. Merge the intended changes into `main`.
2. Confirm CI passes on `main`.
3. Open GitHub Actions.
4. Select the requested deployment workflow, such as `BUILD IMAGE` or `MOBILE RELEASE`.
5. Confirm the maintainer explicitly requested that deployment artifact for this task.
6. Run the workflow manually.
7. Confirm the expected artifact was published.

## 5. Docker Server Release

Docker server release means publishing the server/web runtime image with the
`BUILD IMAGE` workflow.

Keep Docker server release decisions separate from Android mobile release
decisions:

- A server change can require `BUILD IMAGE` without requiring `MOBILE RELEASE`.
- A mobile-only change can require `MOBILE RELEASE` without requiring `BUILD IMAGE`.
- If both artifacts are needed, treat them as two explicit maintainer requests and
  run the workflows separately.

Docker server release checklist:

1. Confirm `main` CI passes.
2. Confirm the maintainer explicitly requested Docker image build/publish/deploy
   for the current task.
3. Run `BUILD IMAGE` manually from GitHub Actions.
4. Confirm `baealex/ocean-wave:latest` was pushed for the expected commit.
5. Check the GitHub Actions summary for the pushed image digest and use it when
   reporting the image publication result. Do not infer that mobile APK
   publication is also needed.

Docker rollback means republishing or redeploying a known-good server image or
commit according to the hosting environment. It is independent from Android app
rollback rules.

## 6. Android Mobile Release

Android mobile release means publishing a release-signed APK with the
`MOBILE RELEASE` workflow for GitHub Releases and Obtainium users.

Keep mobile releases independent from Docker server releases:

- Mobile release uses `mobile-v<version_name>` GitHub Release tags.
- Mobile users update by Android package signature and monotonically increasing
  `versionCode`.
- Publishing a mobile APK does not publish or redeploy the Docker server image.
- Publishing a Docker image does not publish a mobile APK.

Mobile release checklist:

1. Confirm `main` CI passes, including the Android mobile assemble job.
2. Confirm the maintainer explicitly requested a mobile APK release for the
   current task.
3. Choose a `version_name` for the GitHub Release tag and APK file name.
4. Choose a `version_code` higher than every previously published APK for this
   application ID and signing key.
5. Run `MOBILE RELEASE` manually from GitHub Actions.
6. Confirm the `mobile-v<version_name>` release and APK asset were published.

Mobile rollback is not an old APK redeploy. Android will not install an update
with a lower or reused `versionCode` over an existing installation. If a released
APK must be corrected, create a hotfix APK from the known-good code or fix commit
and publish it with a higher `versionCode`. Use a new `version_name` or another
clear hotfix version label so Obtainium and testers see it as the latest build.

## 7. Release Impact

Docker image publishing updates the runtime artifact used by deployments.

Any change to the Docker build path, Docker image tag, deployment workflow, or runtime startup behavior is release-impacting and must be called out in PR notes.

## 8. Agent Guardrail

When an agent changes CI, workflow files, Dockerfiles, dependencies, docs, or any other release-adjacent files, the default stopping point is:

1. PR merged into `main`.
2. CI on `main` confirmed passing.
3. Report the status to the maintainer.

The agent must not continue into Docker image publishing, mobile release publishing, or any other deployment artifact publication unless the maintainer explicitly says to run the relevant build, publish the artifact, deploy, or equivalent wording for the current task. Ambiguous phrases such as "update actions", "merge it", "verify CI", or prior-turn deployment requests are not enough.

A request for one release channel is not permission for the other channel. Docker
server release and Android mobile release must remain separate unless the
maintainer explicitly asks for both in the current task.

