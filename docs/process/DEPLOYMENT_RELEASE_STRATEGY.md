# Ocean Wave Deployment and Release Strategy

Updated: 2026-05-11

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
- Current mobile releases are alpha/pre-release debug-signed APKs, not Play Store or production-signed builds.

## 3. Manual Deployment Flow

1. Merge the intended changes into `main`.
2. Confirm CI passes on `main`.
3. Open GitHub Actions.
4. Select the requested deployment workflow, such as `BUILD IMAGE` or `MOBILE RELEASE`.
5. Confirm the maintainer explicitly requested that deployment artifact for this task.
6. Run the workflow manually.
7. Confirm the expected artifact was published.

## 4. Release Impact

Docker image publishing updates the runtime artifact used by deployments.

Any change to the Docker build path, Docker image tag, deployment workflow, or runtime startup behavior is release-impacting and must be called out in PR notes.

## 5. Agent Guardrail

When an agent changes CI, workflow files, Dockerfiles, dependencies, docs, or any other release-adjacent files, the default stopping point is:

1. PR merged into `main`.
2. CI on `main` confirmed passing.
3. Report the status to the maintainer.

The agent must not continue into Docker image publishing, mobile release publishing, or any other deployment artifact publication unless the maintainer explicitly says to run the relevant build, publish the artifact, deploy, or equivalent wording for the current task. Ambiguous phrases such as "update actions", "merge it", "verify CI", or prior-turn deployment requests are not enough.

