import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: string };
    user: { sub: string; role: string };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
    // Attempts jwtVerify but never rejects the request — req.user is only
    // populated when a valid token was actually sent, so handlers using
    // this must treat req.user as possibly absent despite the type above.
    tryAuthenticate: (req: import("fastify").FastifyRequest) => Promise<void>;
    requireAdmin: (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
    rejectIfBanned: (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
  }
}
