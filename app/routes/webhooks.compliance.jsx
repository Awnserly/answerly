import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { topic, shop, session, admin, payload } =
    await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  return new Response(null, { status: 200 });
};