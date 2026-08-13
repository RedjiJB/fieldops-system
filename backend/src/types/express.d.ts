// Augments Express's Request type with the auth context set by
// middleware/auth.ts — required for `req.auth` to type-check under strict.
export {};

declare global {
  namespace Express {
    interface Request {
      auth?:
        | { type: "service" }
        | { type: "user"; userId: string; email: string; name: string; role: string };
    }
  }
}
