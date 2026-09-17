import type { DocumentDescriptor } from "@libre-ai/web-platform";
import { QuestionnaireApp } from "../ui/questionnaire-app";

// SSR renders the empty questionnaire (no store on the server); the clientModule
// hydrates it into the interactive, IndexedDB-backed app.
export function boussoleDocument(): DocumentDescriptor {
  return {
    app: <QuestionnaireApp />,
    clientModule: "/assets/app.js",
    description: "Boussole civique de Libre AI — questionnaire entièrement sur votre appareil.",
    lang: "fr",
    manifest: "/manifest.webmanifest",
    stylesheets: ["/assets/styles.css"],
    title: "Libre AI — Boussole",
  };
}
