import { createFileRoute, redirect } from "@tanstack/react-router";

// The real dashboard lives at /_authed/. This root route just forwards to it
// so unauthenticated visitors go to /login via the _authed guard.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/" as never, replace: true, from: undefined, search: () => ({}), reloadDocument: false });
  },
  component: () => null,
});
