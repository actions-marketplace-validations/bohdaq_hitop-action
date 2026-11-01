# hitop action

Run a [hitop](https://github.com/bohdaq/hitop) API collection in GitHub Actions. The action runs
`hitop run` in the `ghcr.io/bohdaq/hitop` image, uploads the JUnit report as an artifact, writes a
job summary of every request and check, and fails the step when a request fails.

```yaml
jobs:
  api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: bohdaq/hitop-action@v1
        with:
          version: 1.0.0   # pin a hitop version
          path: ./my-api        # the collection folder in your repository
          env: staging          # environments/staging.yaml
        env:
          HITOP_SECRET_STAGING_TOKEN: ${{ secrets.API_TOKEN }}
```

The collection folder format is described in the
[collection format spec](https://github.com/bohdaq/hitop/blob/main/spec/collection-format.md);
`hitop init` and `hitop convert` create one. The full guide is
[Run hitop in GitHub Actions](https://hitop.rws8.tech/terms/run-hitop-in-github-actions.html).

## Requirements

- A Linux runner with Docker (`ubuntu-latest` and other GitHub hosted Ubuntu runners have it).
  macOS and Windows runners can install the hitop binary from
  [GitHub Releases](https://github.com/bohdaq/hitop/releases) and run `hitop run` directly.
- Pin `version`. It is the image tag, so a new hitop release never changes your pipeline until you
  update it. Tags: [ghcr.io/bohdaq/hitop](https://github.com/bohdaq/hitop/pkgs/container/hitop).
  A tag that isn't on ghcr.io but is already on the runner (an image an earlier step built and
  tagged `ghcr.io/bohdaq/hitop:<tag>`) is used as it is, with a notice in the log (since v1.0.1).

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `version` | (required) | hitop version, the image tag, for example `1.0.0`. |
| `path` | `.` | Collection folder relative to the workspace (or a collection name). |
| `env` | | Environment from the folder's `environments/` (`--env`). |
| `env-file` | | Environment file anywhere in the workspace (`--env-file`). Use `env` or `env-file`, not both. |
| `reporter` | `cli,junit,json` | Reporters (`--reporter`). The summary needs `json`, the artifact needs `junit`. |
| `out` | `hitop-reports` | Report folder relative to the workspace (`--out`). |
| `secrets` | | Secret variables, one `NAME=value` per line, passed as `--secret` and masked in the log. |
| `vars` | | Variables, one `key=value` per line, passed as `--var`. Not masked. |
| `args` | | More `hitop run` arguments, split on whitespace, for example `--bail --timeout 5000`. |
| `artifact-name` | `hitop-junit` | Name of the JUnit artifact. Empty skips the upload. |
| `summary` | `true` | Write the job summary. |

## Outputs

| Output | Meaning |
| --- | --- |
| `exit-code` | `0` every request passed, `1` a request or check failed, `2` usage or configuration error. |
| `passed` | `true` when every request passed. |
| `report-dir` | Absolute path of the report folder. |
| `junit-file` | Path of `junit.xml`, empty when not written. |
| `report-file` | Path of `report.json` ([report format](https://github.com/bohdaq/hitop/blob/main/spec/run-report.md)), empty when not written. |

The step fails when the exit code is not 0. Use `continue-on-error: true` and the `exit-code`
output to decide yourself.

## Secrets

A variable marked `secret: true` in an environment file has no value in the repository. Give it
one of two ways:

- **Environment variable** `HITOP_SECRET_<ENV>_<NAME>`, upper case, every other character turned
  into `_`. For `token` in environment `staging`: `HITOP_SECRET_STAGING_TOKEN`. Set it in the
  step's `env:`. The action passes every `HITOP_*` variable of the step to hitop by name, so the
  value never appears on a command line.
- **The `secrets` input**, one `NAME=value` per line, for any environment:

  ```yaml
  with:
    secrets: |
      token=${{ secrets.API_TOKEN }}
      apiKey=${{ secrets.API_KEY }}
  ```

hitop shows secret values as `••••` in its log and in both reports. Never put secrets in `vars`.

## Services on localhost

The container uses the host network, so a collection can call a server the job started earlier
(`npm start &`, or a [service container](https://docs.github.com/actions/using-containerized-services)
with a mapped port) at `http://localhost:<port>`.

## Test report in the checks tab

The artifact holds `junit.xml`. To see each request as a test with its failure message, add a test
report action after this one:

```yaml
      - uses: bohdaq/hitop-action@v1
        id: hitop
        continue-on-error: true
        with:
          version: 1.0.0
          path: ./my-api
      - uses: dorny/test-reporter@v3
        if: always()
        with:
          name: API tests
          path: hitop-reports/junit.xml
          reporter: java-junit
      - if: steps.hitop.outputs.exit-code != '0'
        run: exit 1
```

`dorny/test-reporter` v3 writes its report to the job summary; with `use-actions-summary: false` it
creates a check run instead, which needs `permissions: checks: write`. `mikepenz/action-junit-report`
creates a check run with one annotation per failed request (title `<collection>.<request>`, message
the failure line). The self-test in this repository runs
both `dorny/test-reporter` and `mikepenz/action-junit-report` on hitop's report.

## License

MIT, see [LICENSE](LICENSE). hitop itself is MIT too.
