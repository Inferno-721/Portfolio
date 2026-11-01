type Cv = typeof import("../../../../cv.json");

export type ChunkKind =
  "experience" | "project" | "skill" | "achievement" | "education" | "post";

/** One retrievable fact: a single role highlight, project, skill group or post. */
export type Chunk = {
  id: string;
  kind: ChunkKind;
  title: string;
  text: string;
  url: string | null;
  date: string | null;
};

export type KnowledgePost = {
  id: string;
  title: string | null;
  excerpt: string;
  url: string;
  publishedAt: string;
  sourceName: string;
};

export type ProfileFacts = {
  name: string;
  email: string;
  emailUrl: string;
  githubUrl: string;
  linkedinUrl: string;
  resumeUrl: string;
};

export type Knowledge = {
  chunks: Chunk[];
  projects: Cv["projects"];
  work: Cv["work"];
  posts: KnowledgePost[];
  facts: ProfileFacts;
};

function socialUrl(cv: Cv, network: string): string {
  return (
    cv.basics.socials.find((social) => social.network === network)?.url ?? ""
  );
}

export function buildKnowledge(
  cv: Cv,
  posts: KnowledgePost[],
  resumeUrl: string,
): Knowledge {
  const chunks: Chunk[] = [];

  for (const role of cv.work) {
    chunks.push({
      id: `role:${role.company}`,
      kind: "experience",
      title: role.company,
      text: `${role.position} at ${role.company}, ${role.location}. Stack: ${role.stack.join(", ") || "not listed"}.`,
      url: role.url,
      date: role.startDate,
    });
    for (const highlight of role.highlights) {
      chunks.push({
        id: `role:${role.company}:${highlight.title}`,
        kind: "experience",
        title: role.company,
        text: `${highlight.title}: ${highlight.text}`,
        url: role.url,
        date: role.startDate,
      });
    }
  }

  for (const project of cv.projects) {
    chunks.push({
      id: `project:${project.name}`,
      kind: "project",
      title: project.name,
      text: [
        project.description,
        ...project.highlights,
        `How it works: ${project.flow.join(" → ")}.`,
        `Stack: ${project.stack.join(", ")}.`,
        project.note ?? "",
      ].join(" "),
      url: project.url,
      date: null,
    });
  }

  for (const principle of cv.principles) {
    chunks.push({
      id: `principle:${principle.title}`,
      kind: "experience",
      title: `Approach: ${principle.title}`,
      text: principle.text,
      url: null,
      date: null,
    });
  }

  for (const group of cv.skills) {
    chunks.push({
      id: `skill:${group.category}`,
      kind: "skill",
      title: `Skills: ${group.category}`,
      text: group.items.join(", "),
      url: null,
      date: null,
    });
  }

  for (const achievement of cv.achievements) {
    chunks.push({
      id: `achievement:${achievement.title}`,
      kind: "achievement",
      title: achievement.title,
      text: `Award: ${achievement.detail}`,
      url: null,
      date: achievement.date,
    });
  }

  for (const school of cv.education) {
    chunks.push({
      id: `education:${school.institution}`,
      kind: "education",
      title: school.institution,
      text: `Education and college degree (where Shubham studied): ${school.degree}. ${school.note}.`,
      url: school.url,
      date: school.startDate,
    });
  }

  for (const post of posts) {
    chunks.push({
      id: `post:${post.id}`,
      kind: "post",
      title: post.title ?? post.excerpt.slice(0, 80),
      text: post.excerpt,
      url: post.url,
      date: post.publishedAt,
    });
  }

  return {
    chunks,
    projects: cv.projects,
    work: cv.work,
    posts,
    facts: {
      name: cv.basics.name,
      email: socialUrl(cv, "email").replace("mailto:", ""),
      emailUrl: socialUrl(cv, "email"),
      githubUrl: socialUrl(cv, "github"),
      linkedinUrl: socialUrl(cv, "linkedin"),
      resumeUrl,
    },
  };
}
