# GitHub Actions templates

The `ci.yml` and `pages.yml` files in this folder are workflow examples. A GitHub token with the `workflow` scope is required to publish files under `.github/workflows/`; the current publishing authorization does not include that scope. The live site is therefore published from the `gh-pages` branch instead of Actions.

To enable Actions later, copy the desired YAML file into `.github/workflows/` and push it with an authorization that includes `workflow`.
