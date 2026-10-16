# Bounded braces fork

The upstream MIT `braces@3.0.3` implementation and license are retained unmodified in `upstream.js`/`lib`. `index.js` guards every public string/AST entrypoint before recursion. This remediates stack exhaustion from deeply nested patterns (GHSA-vfj7-8cjw-p6xm) and caps length, complexity, ranges and AST work. Only trusted local build globs are used by this application; the dependency is absent from production routes.

A local npm override replaces the vulnerable parser with this maintained fork. This is a source-level security fix, not an audit severity downgrade. Tests assert malicious nesting/ranges/combinatorial input rejection and legitimate Micromatch/Fast-glob compatibility. Retest this fork if updating upstream or changing limits. Do not accept arbitrary build globs from web visitors.
