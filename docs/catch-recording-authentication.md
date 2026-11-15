# Catch Recording authentication (superseded)

The Authentication Service based flow (`authentication-service` Hapi strategy, `{ userId, scopes }` context,
`AUTHENTICATION_SERVICE_*` settings, and every fixed or mock bearer token) has been **removed**. There is no
fallback, compatibility layer or development bypass.

Authentication and authorization are now:

1. a signed Microsoft Entra External ID access token, validated locally (signature, exact issuer and audience,
   algorithm, lifetime);
2. a trusted `{ userId }` context taken only from the configured identity claim;
3. roles and role-to-capability definitions read from the User Profile Service and cached;
4. capability, resource and domain authorization.

See [`entra-authentication.md`](./entra-authentication.md) for the current behaviour, configuration and
operations, and [`configuration-decisions.md`](./configuration-decisions.md) for the settings.
