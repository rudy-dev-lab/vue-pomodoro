// .github/scripts/linkedin-post.mjs
// Generates a LinkedIn post from README via Claude API, then publishes it.
// Called by the GitHub Actions workflow — do not run locally (use get-linkedin-token.mjs instead).

import { readFileSync, existsSync } from 'fs';

// ─── Env validation ───────────────────────────────────────────────────────────

const {
  DEPLOY_URL,
  GITHUB_REPO_URL,
  GITHUB_REPO_NAME,
  ANTHROPIC_API_KEY,
  LINKEDIN_CLIENT_ID,
  LINKEDIN_CLIENT_SECRET,
  LINKEDIN_REFRESH_TOKEN,
  LINKEDIN_PERSON_URN,
} = process.env;

const REQUIRED = [
'LINKEDIN_ACCESS_TOKEN',
'LINKEDIN_PERSON_URN',
];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`❌ Missing env vars: ${missing.join(', ')}`);
  process.exit(1);
}

// ─── Token refresh ────────────────────────────────────────────────────────────
// Always refresh — no need to store the short-lived access token as a secret.

async function getAccessToken() {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) throw new Error('Missing LINKEDIN_ACCESS_TOKEN');
  console.log('🔑 Using LinkedIn access token');
  return token;
}

// ─── README reader ────────────────────────────────────────────────────────────

function readReadme() {
  const candidates = ['README.md', 'readme.md', 'Readme.md'];
  for (const file of candidates) {
    if (existsSync(file)) {
      console.log(`📖 Reading ${file}`);
      return readFileSync(file, 'utf-8').slice(0, 4000);
    }
  }
  console.warn('⚠️  No README found — using repo name as fallback');
  return `# ${GITHUB_REPO_NAME}\n\nMicro side project de montée en compétences frontend.`;
}

// ─── Claude post generation ───────────────────────────────────────────────────

async function generatePost(readme) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system:
        'Tu es un développeur senior qui partage ses apprentissages techniques ' +
        'sur LinkedIn de façon authentique, directe et sans bullshit corporate. ' +
        'Tes posts sont courts, percutants, et donnent envie de lire.',
      messages: [
        {
          role: 'user',
          content: `À partir de ce README de projet GitHub, génère un post LinkedIn en français.

Contraintes strictes :
- Maximum 1200 caractères au total
- Commence par un emoji accrocheur
- 2-3 phrases sur ce qui a été construit et les apprentissages clés
- Hashtags tech pertinents à la fin (5 max)
- Ton humain et direct, pas de formules creuses
- NE PAS inclure les liens GitHub ou Netlify (ajoutés automatiquement)
- Réponds UNIQUEMENT avec le texte du post, sans guillemets ni balises

README du projet :
---
${readme}
---`,
        },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Claude API error: ${JSON.stringify(data)}`);

  const text = data.content?.find((b) => b.type === 'text')?.text?.trim();
  if (!text) throw new Error('Empty response from Claude');

  console.log('\n🤖 Generated post:\n─────────────────────\n' + text + '\n─────────────────────\n');
  return text;
}

// ─── LinkedIn publish ─────────────────────────────────────────────────────────

async function postToLinkedIn(accessToken, postText) {
  const fullText = [
    postText,
    '',
    `🔗 GitHub : ${GITHUB_REPO_URL}`,
    `🌐 Live   : ${DEPLOY_URL}`,
  ].join('\n');

  const body = {
    author: LINKEDIN_PERSON_URN,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: fullText },
        shareMediaCategory: 'ARTICLE',
        media: [
          {
            status: 'READY',
            description: { text: `Projet live sur Netlify · voir le rendu en direct` },
            originalUrl: DEPLOY_URL,
            title: { text: GITHUB_REPO_NAME },
          },
        ],
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`LinkedIn post failed: ${JSON.stringify(data)}`);

  const id = data.id ?? JSON.stringify(data.value ?? data);
  console.log(`✅ LinkedIn post published — ID: ${id}`);
  return id;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const readme = readReadme();

  // Parallelise: Claude + token refresh at the same time
  const [postText, accessToken] = await Promise.all([
    generatePost(readme),
    getAccessToken(),
  ]);

  await postToLinkedIn(accessToken, postText);
}

main().catch((err) => {
  console.error('\n❌ Pipeline failed:', err.message);
  process.exit(1);
});
