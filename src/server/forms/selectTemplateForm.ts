import type { Context } from 'hono';
import { settings } from "@devvit/web/server";

export const handleSelectTemplateForm = async (c: Context) => {
  const event = await c.req.json();
  const templateSelection = event.templateNumber || event.values?.templateNumber;
  
  if (!templateSelection || templateSelection.length === 0) {
    return c.json({ showToast: { text: "You must select a template." } });
  }

  // Extract the number (e.g. "template3" -> "3")
  const tNum = templateSelection[0].replace('template', '');
  
  const tempTitle = (await settings.get(`postTemplate${tNum}title`)) as string;
  const tempBody = (await settings.get(`postTemplate${tNum}body`)) as string;
  const tempName = (await settings.get(`postTemplate${tNum}name`)) as string;

  return c.json({
    showForm: {
      name: "submitTemplateForm",
      form: {
        title: tempName,
        acceptLabel: "Submit",
        cancelLabel: "Cancel",
        fields: [
          { name: "finalTitle", label: "Post title", type: "string", defaultValue: tempTitle },
          { name: "finalBody", label: "Post body", type: "paragraph", defaultValue: tempBody },
          { name: "mybDist", label: "Distinguish?", type: "boolean", defaultValue: true, disabled: true },
          { name: "iSticky", label: "Sticky?", type: "boolean" },
          { name: "iLock", label: "Lock?", type: "boolean" }
        ]
      }
    }
  });
};