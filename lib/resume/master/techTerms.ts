// Common technology and tool names across tech role families, used to find the skills a posting
// mentions when the AI extraction didn't return a skills list, and by validate.ts to spot tools on a
// tailored resume. The candidate's own skills inventory is always searched too, so anything they
// list counts even if it isn't here. Keep entries in their usual spelling; matching is whole-word
// and case-insensitive except for short or ambiguous names (see mentionsTerm).

export const TECH_TERM_FAMILIES = {
  languages: [
    "Python", "Java", "JavaScript", "TypeScript", "C", "C++", "C#", "Go", "Rust", "Swift", "Objective-C", "Kotlin",
    "Scala", "Ruby", "PHP", "R", "MATLAB", "SQL", "Bash", "Dart", "Elixir", "Haskell", "Lua", "Perl", "Julia",
  ],
  webAndMobile: [
    "React", "Next.js", "Vue", "Angular", "Svelte", "Node.js", "Express", "Django", "Flask", "FastAPI", "Spring",
    "Spring Boot", "Rails", ".NET", "GraphQL", "REST", "HTML", "CSS", "Tailwind", "Redux", "React Native", "Flutter",
    "SwiftUI", "UIKit", "iOS", "Android", "watchOS", "macOS", "WebSockets", "gRPC",
  ],
  data: [
    "PostgreSQL", "MySQL", "MongoDB", "Redis", "DynamoDB", "Cassandra", "Elasticsearch", "Snowflake", "BigQuery",
    "Kafka", "Spark", "Hadoop", "Airflow", "dbt", "Pandas", "NumPy", "Tableau", "Looker", "Power BI", "Excel",
    "Databricks", "Statistics", "A/B Testing", "SAS",
  ],
  ml: [
    "PyTorch", "TensorFlow", "scikit-learn", "Machine Learning", "Deep Learning", "LLMs", "NLP", "Computer Vision",
    "Core ML", "Hugging Face", "LangChain", "RAG", "MLOps", "MLflow", "SageMaker", "Vertex AI", "CUDA", "JAX", "XGBoost",
  ],
  cloudAndDevOps: [
    "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform", "Linux", "CI/CD", "GitHub Actions", "Jenkins", "Git",
    "Microservices", "Distributed Systems", "Ansible", "Helm", "Prometheus", "Grafana", "Datadog", "Nginx", "Argo CD",
    "CloudFormation", "Pulumi", "Splunk",
  ],
  security: ["OWASP", "IAM", "SIEM", "Penetration Testing", "Burp Suite", "Wireshark"],
  qa: [
    "Jest", "Cypress", "Playwright", "Selenium", "Unit Testing", "Appium", "JUnit", "pytest", "TestNG", "Postman",
    "JMeter", "Cucumber",
  ],
  product: ["Agile", "Jira", "Confluence", "Amplitude", "Mixpanel", "Roadmapping", "PRDs"],
  design: [
    "Figma", "Sketch", "Adobe XD", "Photoshop", "Illustrator", "Framer", "Prototyping", "Wireframing", "User Research",
    "Usability Testing", "Design Systems",
  ],
  embedded: ["RTOS", "Embedded Linux", "Verilog", "VHDL", "FPGA"],
} as const satisfies Record<string, readonly string[]>;

export type TechFamily = keyof typeof TECH_TERM_FAMILIES;

/** Every family's terms in one list, without repeats. */
export const TECH_TERMS: string[] = [...new Set(Object.values(TECH_TERM_FAMILIES).flat())];

/**
 * Names that are also ordinary English words, so they only count in their own capitalization
 * ("excel at", "sketch out", "a swift response" aren't skills). Short names (4 characters or
 * fewer, like C, R, Go, Git, REST, Jira) are always matched that way too.
 */
const ORDINARY_WORDS = new Set(["Swift", "Excel", "Sketch", "Framer", "Looker"]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whole-word, case-insensitive. Very short or ambiguous names (C, R, Go, Git, REST, iOS...) must
 * match case-sensitively, or "go" and "rest" in ordinary sentences would count. `exactCase` makes
 * every term case-sensitive, for scanning prose where "express" or "spring" are ordinary words.
 */
export function mentionsTerm(text: string, term: string, opts: { exactCase?: boolean } = {}): boolean {
  const caseSensitive = opts.exactCase || term.length <= 4 || ORDINARY_WORDS.has(term);
  const re = new RegExp(`(^|[^A-Za-z0-9+#.-])${escapeRe(term)}(?![A-Za-z0-9+#&-])`, caseSensitive ? "" : "i");
  return re.test(text);
}
