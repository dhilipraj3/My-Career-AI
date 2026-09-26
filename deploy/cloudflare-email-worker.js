// Cloudflare Email Worker: hands every email sent to your alert addresses (u-xxxx@in.example.com) to MyCareer.AI.
//
// Setup (all free):
//   1. Add your domain to Cloudflare and turn on Email Routing.
//   2. Create a Worker with this file. Add two variables in the Worker's settings:
//        APP_URL  = https://app.example.com            (where MyCareer.AI runs)
//        SECRET   = <a long random string>             (the same value as INBOUND_WEBHOOK_SECRET on the server)
//   3. In Email Routing, add a catch-all rule for the alert subdomain with the action "Send to a Worker".
//   4. On the server set INBOUND_EMAIL_DOMAIN (e.g. in.example.com) and INBOUND_WEBHOOK_SECRET.
//
// The raw message is posted as-is; the server reads and limits it. Nothing is stored by the Worker.
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    if (raw.byteLength > 5 * 1024 * 1024) return; // too large to be a job alert
    const res = await fetch(`${env.APP_URL}/api/inbound/email`, {
      method: "POST",
      headers: { "Content-Type": "message/rfc822", "X-Inbound-Secret": env.SECRET, "X-Inbound-To": message.to },
      body: raw,
    });
    if (!res.ok) console.log("MyCareer.AI rejected the email:", res.status);
  },
};
