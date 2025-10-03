import { Hono } from "hono";
import { cors } from "hono/cors";
import * as Sentry from "@sentry/cloudflare";

import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";

const app = new Hono<{ Bindings: Env }>();
app.use("*", cors());

app.onError((err, c) => {
  // Report _all_ unhandled errors.
  Sentry.captureException(err);
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  // Or just report errors which are not instances of HTTPException
  // Sentry.captureException(err);
  return c.json({ error: "Internal server error" }, 500);
});

export const configSchema = z.object({
  function: z.string(),
  plugin_setting: z.object({
    id: z.string(),
    settings_custom_fields_values_base_url: z.string(),
    settings_custom_fields_values_api_key: z.string(),
    settings_custom_fields_values_organization: z.string(),
    settings_custom_fields_values_projects: z.string(),
    settings_custom_fields_values_period: z.string(),
    settings_strategy: z.string(),
    settings_polling_verb: z.string(),
    settings_no_screen_padding: z.string(),
    settings_dark_mode: z.string(),
    name: z.string(),
    refresh_interval: z.string(),
  }),
});

export const schema = z.object({
  base_url: z.string(),
  api_key: z.string(),
  organization: z.string(),
  projects: z.string(),
  period: z.string(),
});

app.post("/orgs", zValidator("json", configSchema), async (c) => {
  const pluginData = c.req.valid("json");

  const baseDomain =
    pluginData.plugin_setting.settings_custom_fields_values_base_url;

  const rawSentryOrgs = await fetch(`${baseDomain}/api/0/organizations/`, {
    headers: {
      Authorization: `Bearer ${pluginData.plugin_setting.settings_custom_fields_values_api_key}`,
      "Content-Type": "application/json",
    },
  });
  const orgs = (await rawSentryOrgs.json()) as Array<{
    id: string;
    name: string;
  }>;

  const result = orgs.map((org) => {
    const res = {} as Record<string, string>;
    res[org.name] = org.id.toString();
    return res;
  });

  return c.json(result);
});

app.post("/projects", zValidator("json", configSchema), async (c) => {
  const pluginData = c.req.valid("json");

  const baseDomain =
    pluginData.plugin_setting.settings_custom_fields_values_base_url;

  const rawSentryProjects = await fetch(
    `${baseDomain}/api/0/organizations/${pluginData.plugin_setting.settings_custom_fields_values_organization}/projects/`,
    {
      headers: {
        Authorization: `Bearer ${pluginData.plugin_setting.settings_custom_fields_values_api_key}`,
        "Content-Type": "application/json",
      },
    }
  );
  const projects = (await rawSentryProjects.json()) as Array<{
    id: string;
    name: string;
  }>;

  const result = projects.map((org) => {
    const res = {} as Record<string, string>;
    res[org.name] = org.id.toString();
    return res;
  });

  return c.json(result);
});

app.post("/data", zValidator("form", schema), async (c) => {
  const pluginData = c.req.valid("form");

  const baseDomain = pluginData.base_url;

  const intervals = {
    '1h': '1m',
    '24h': '5m',
    '7d': '30m',
    '14d': '30m',
    '30d': '1h',
    '90d': '4h',
  }
  const period = pluginData.period as keyof typeof intervals;

  const urls = {
    errors: `${baseDomain}/api/0/organizations/${pluginData.organization}/events/?dataset=errors&field=count_unique%28issue%29&field=count%28%29&name=&per_page=20&query=&sort=count%28%29&statsPeriod=${pluginData.period}&yAxis=count%28%29`,
    events: `${baseDomain}/api/0/organizations/${
      pluginData.organization
    }/events-stats/?dataset=errors&interval=${intervals[period] ?? '1h'}&statsPeriod=${
      period
    }`,
    user_misery_apdex: `${baseDomain}/api/0/organizations/${
      pluginData.organization
    }/events/?dataset=metricsEnhanced&field=apdex%28300%29&field=user_misery%28300%29&name=&onDemandType=dynamic_query&per_page=20&query=&statsPeriod=${
      pluginData.period
    }&useOnDemandMetrics=false&yAxis=user_misery%28300%29`,
    organizations: `${baseDomain}/api/0/organizations/`
  };

  const results = await Promise.all(
    Object.entries(urls).map(async ([k, v]) => [
      k,
      await fetch(v, {
        headers: {
          Authorization: `Bearer ${pluginData.api_key}`,
          "Content-Type": "application/json",
        },
      }).then((res) => res.json()),
    ])
  ).then(Object.fromEntries);

    console.log(results);
  return c.json(results);
});

export default Sentry.withSentry(
  (env: Env) => {
    const { id: versionId } = env.CF_VERSION_METADATA;
    return {
      dsn: env.SENTRY_DSN,
      release: versionId,
      tracesSampleRate: 1.0,
    };
  },
  app
);
