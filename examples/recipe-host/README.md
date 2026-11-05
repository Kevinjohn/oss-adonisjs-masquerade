# Fresh host recipe fixture

This is a small conventional AdonisJS 7 native-session host **before** Masquerade is configured.
It has a numeric `User`, a separate `members` guard, session options, Auth type augmentation,
Shield CSRF, Lucid and SQLite/PostgreSQL configuration. It has no package provider, generated
configuration, context middleware, or Masquerade routes.

`pnpm test:recipe` checks that the code in the setup and usage guides still works:

1. copies this folder into a temporary directory and installs the package built from this checkout;
2. runs `node ace configure @kevinjohn/adonisjs-masquerade --banner --form-controller --no-wire`;
3. writes the code blocks marked `<!-- host-recipe:... -->` in
   [setup](../../docs/guide/setup.md), [usage](../../docs/guide/usage.md) and
   [Edge forms](../../docs/guide/clients/edge.md) into the host, plus the files in `recipe-assets/`;
4. typechecks the result and runs `recipe-assets/journey.spec.ts.txt` on SQLite and PostgreSQL;
5. breaks the form token and the middleware order in turn and confirms the journey fails.

If you edit a marked code block, run `pnpm test:recipe --database=sqlite` before committing.

Its `users` table already has the identity and policy columns the setup guide's example reads. For
the columns a fresh starter kit needs, see the
[starter-kit recipe](../../docs/recipes/starter-kit.md#step-2-add-the-account-columns).

The fixture is deliberately separate from `examples/native-session`, which is an already wired
reference app and consumer matrix fixture.
