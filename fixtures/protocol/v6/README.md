# Protocol v6 token quick fields (UX-07, MV-195)

Deploy matching host and client versions together. Protocol v5 clients (join-profile colours,
UX-31) receive the fatal `protocol-mismatch` response with `supportedVersion: 6`. Save schema
v5 adds optional `token.quickFields`; the `v4-to-v5` migration only advances the version.

New durable intent `token.setQuickField`; token views carry `quickFields` filtered per viewer
(`all`, `owner`, `dm`), so values a viewer may not read are never sent. Message codecs
themselves are unchanged. The v5 join-profile fixture stays as compatibility coverage for its
frame shapes; its `hello.v` is no longer a supported version.
