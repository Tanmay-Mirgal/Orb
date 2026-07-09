import { betterAuth } from "better-auth";
export const auth = betterAuth({
  database: {
    provider: "pg",
    url: "postgresql://orb:password@localhost:5432/orb"
  }
});
