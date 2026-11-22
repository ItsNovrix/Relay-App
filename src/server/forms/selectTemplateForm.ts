import type { Context } from 'hono';
import { settings } from "@devvit/web/server";
import { getPostFlairOptions } from "../utils/helpers.js";

export const handleSelectTemplateForm = async (c: Context) => {
  const event = await c.req.json();
  const templateSelection = event.templateNumber || event.values?.templateNumber;
  
  if (!templateSelection || templateSelection.length === 0) {
    return c.json({ showToast: { text: "You must select a template." } });
  }

  const tNum = templateSelection[0].replace('template', '');
  
  const rawType = await settings.get(`postTemplate${tNum}Type`);
  const postType = ((Array.isArray(rawType) ? rawType[0] : rawType) as string) || "text";
  const tempTitle = (await settings.get(`postTemplate${tNum}title`)) as string;
  const tempUrl = ((await settings.get(`postTemplate${tNum}Url`) as string) || "").trim();
  const tempBody = (await settings.get(`postTemplate${tNum}body`)) as string;
  const tempName = (await settings.get(`postTemplate${tNum}name`)) as string;
  const tempFlairId = ((await settings.get(`postTemplate${tNum}FlairId`) as string) || "").trim();
  const flairOptions = await getPostFlairOptions();
  const hasValidSavedFlair = Boolean(tempFlairId && flairOptions.some((opt) => opt.value === tempFlairId));
  const defaultFlair = hasValidSavedFlair ? tempFlairId : "none";

  return c.json({
    showForm: {
      name: "submitTemplateForm",
      form: {
        title: tempName,
        acceptLabel: "Submit",
        cancelLabel: "Cancel",
        fields: [
          {
            name: "postType",
            label: "Post type",
            type: "select",
            options: [
              { label: "Text Post", value: "text" },
              { label: "Link Post", value: "link" },
              { label: "Media Post (Image / Video)", value: "media" }
            ],
            defaultValue: [postType]
          },
          { name: "finalTitle", label: "Post title", type: "string", defaultValue: tempTitle },
          ...(postType === "link" || postType === "media"
            ? [{
                name: "finalUrl",
                label: postType === "media" ? "Media URL (Image / Video)" : "Link URL",
                type: "string",
                defaultValue: tempUrl,
                required: true
              }]
            : []),
          { name: "finalBody", label: "Post body", type: "paragraph", defaultValue: tempBody },
          ...(flairOptions.length > 0
            ? [{ name: "finalFlairId", label: "Post Flair (optional)", type: "select", options: flairOptions, defaultValue: [defaultFlair] }]
            : []),
          { name: "mybDist", label: "Distinguish?", type: "boolean", defaultValue: true, disabled: true },
          { name: "iSticky", label: "Sticky?", type: "boolean" },
          { name: "iLock", label: "Lock?", type: "boolean" }
        ]
      }
    }
  });
};