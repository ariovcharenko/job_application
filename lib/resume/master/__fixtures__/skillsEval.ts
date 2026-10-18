// Evaluation set for the skills analysis: fictional postings (as the extraction step might return
// them, messy on purpose) and two fictional candidates, with hand-labeled expectations. Used by
// skills.eval.test.ts. Nothing here describes a real person or employer.
import { MASTER } from "../../engine/__fixtures__/master";

export const ALEX_MASTER = MASTER;

export const SAM_MASTER = `### Education
**Northgate Institute of Technology**, Pittsburgh, PA
Bachelor of Science in Electrical and Computer Engineering | Aug 2021 - May 2025
- Relevant coursework: Operating Systems, Digital Logic, Control Systems, Data Structures

### Experience

**Firmware Engineer | Kestrel Robotics | Pittsburgh, PA | Jun 2025 - Present**
- Wrote C firmware for STM32 motor controllers on FreeRTOS, using SPI and CAN bus to talk to sensor boards.
- Built a ROS 2 navigation node in C++ and tested it in simulation with Gazebo.
- Set up GitHub Actions builds that run unit tests on every commit.
- Go through each board revision with the test team before release.

**Research Assistant | Vision and Learning Lab | Pittsburgh, PA | Jan 2024 - May 2025**
- Trained object detection models with PyTorch and OpenCV on a 40,000 image dataset.
- Cleaned and analyzed experiment results with Pandas and NumPy, plotted in Matplotlib.
- Wrote Python scripts and Bash tooling to run training jobs on a Linux GPU cluster.

### Projects

**Greenhouse Monitor | Personal project | 2024**
- Built an ESP32 sensor node reading I2C sensors and posting data to a small Flask API backed by SQLite.

### Skills inventory
- **Languages:** C, C++, Python, MATLAB, Bash
- **Embedded:** FreeRTOS, STM32, ESP32, I2C, SPI, UART, CAN bus, Embedded Linux, ROS 2
- **ML and data:** PyTorch, OpenCV, NumPy, Pandas, scikit-learn, Matplotlib, SQLite
- **Tools:** Git, Linux, Docker, GitHub Actions, Jenkins
- **Cloud:** AWS (S3, EC2)
`;

export interface EvalPosting {
  id: string;
  family: string;
  /** What the extraction step returned, quirks included. */
  required: string[];
  preferred: string[];
  expect: {
    /** The lists a careful reader would end up with (names as the cleaner should write them). */
    required: string[];
    preferred: string[];
    /** Which of those each candidate has, by expected name. Everything else is a gap. */
    alex: string[];
    sam: string[];
  };
}

export const EVAL_POSTINGS: EvalPosting[] = [
  {
    id: "swe-newgrad", family: "SWE new grad",
    required: ["Bachelor's degree in Computer Science or related field", "Proficiency in Python/Java", "Experience with AWS (EC2, S3)", "Strong communication skills", "Data structures and algorithms", "REST APIs", "SQL"],
    preferred: ["Kubernetes", "CI/CD pipelines", "experience with Docker"],
    expect: {
      required: ["Python", "Java", "AWS", "Data structures and algorithms", "REST APIs", "SQL"],
      preferred: ["Kubernetes", "CI/CD", "Docker"],
      alex: ["Python", "Java", "AWS", "Data structures and algorithms", "REST APIs", "SQL", "Docker"],
      sam: ["Python", "AWS", "SQL", "CI/CD", "Docker"],
    },
  },
  {
    id: "backend", family: "Backend",
    required: ["3+ years of experience with Java or Go", "Spring Boot", "PostgreSQL/MySQL", "Microservices", "Message queues (Kafka, RabbitMQ)"],
    preferred: ["Redis", "Terraform", "gRPC"],
    expect: {
      required: ["Java or Go", "Spring Boot", "PostgreSQL", "MySQL", "Microservices", "Message queues (Kafka, RabbitMQ)"],
      preferred: ["Redis", "Terraform", "gRPC"],
      alex: ["Java or Go", "Spring Boot", "PostgreSQL", "MySQL"],
      sam: [],
    },
  },
  {
    id: "frontend", family: "Frontend",
    required: ["React", "TypeScript", "HTML/CSS", "Familiarity with modern JavaScript frameworks"],
    preferred: ["React Native", "GraphQL", "Jest", "Next.js", "Accessibility (WCAG)"],
    expect: {
      required: ["React", "TypeScript", "HTML", "CSS", "modern JavaScript frameworks"],
      preferred: ["React Native", "GraphQL", "Jest", "Next.js", "Accessibility"],
      alex: ["React", "TypeScript", "HTML", "CSS", "modern JavaScript frameworks", "React Native", "Jest", "Next.js"],
      sam: [],
    },
  },
  {
    id: "ios", family: "Mobile (iOS)",
    required: ["Swift", "SwiftUI or UIKit", "iOS SDK", "Xcode", "REST APIs"],
    preferred: ["Kotlin", "Core Data", "Unit testing"],
    expect: {
      required: ["Swift", "SwiftUI or UIKit", "iOS SDK", "Xcode", "REST APIs"],
      preferred: ["Kotlin", "Core Data", "Unit testing"],
      alex: ["REST APIs", "Unit testing"],
      sam: ["Unit testing"],
    },
  },
  {
    id: "android", family: "Mobile (Android)",
    required: ["Kotlin", "Android SDK", "Jetpack Compose", "Java"],
    preferred: ["React Native", "Firebase", "CI/CD (GitHub Actions, Jenkins)"],
    expect: {
      required: ["Kotlin", "Android SDK", "Jetpack Compose", "Java"],
      preferred: ["React Native", "Firebase", "CI/CD (GitHub Actions, Jenkins)"],
      alex: ["Java", "React Native"],
      sam: ["CI/CD (GitHub Actions, Jenkins)"],
    },
  },
  {
    id: "ml", family: "ML / AI",
    required: ["Python", "PyTorch or TensorFlow", "ML", "Experience with LLMs", "Statistics"],
    preferred: ["Hugging Face", "RAG", "MLOps", "CUDA"],
    expect: {
      required: ["Python", "PyTorch or TensorFlow", "Machine learning", "LLMs", "Statistics"],
      preferred: ["Hugging Face", "RAG", "MLOps", "CUDA"],
      alex: ["Python", "LLMs"],
      sam: ["Python", "PyTorch or TensorFlow", "Machine learning"],
    },
  },
  {
    id: "data-analyst", family: "Data analyst",
    required: ["SQL", "Python or R", "Tableau or Power BI", "Excel", "A/B testing", "Data visualization"],
    preferred: ["dbt", "Snowflake", "Looker", "Statistics"],
    expect: {
      required: ["SQL", "Python or R", "Tableau or Power BI", "Excel", "A/B testing", "Data visualization"],
      preferred: ["dbt", "Snowflake", "Looker", "Statistics"],
      alex: ["SQL", "Python or R"],
      sam: ["SQL", "Python or R", "Data visualization"],
    },
  },
  {
    id: "data-eng", family: "Data engineering",
    required: ["SQL", "Python", "Apache Spark", "Airflow", "ETL pipelines", "Cloud platforms (AWS, GCP, Azure)"],
    preferred: ["Kafka", "Docker", "NoSQL databases"],
    expect: {
      required: ["SQL", "Python", "Spark", "Airflow", "ETL pipelines", "Cloud platforms (AWS, GCP, Azure)"],
      preferred: ["Kafka", "Docker", "NoSQL"],
      alex: ["SQL", "Python", "Cloud platforms (AWS, GCP, Azure)", "Docker"],
      sam: ["SQL", "Python", "Cloud platforms (AWS, GCP, Azure)", "Docker"],
    },
  },
  {
    id: "product", family: "Product",
    required: ["Product roadmapping", "Agile/Scrum", "SQL", "Stakeholder communication", "Jira", "User research"],
    preferred: ["A/B testing", "Figma", "Amplitude"],
    expect: {
      required: ["Product roadmapping", "Agile", "Scrum", "SQL", "Jira", "User research"],
      preferred: ["A/B testing", "Figma", "Amplitude"],
      alex: ["SQL"],
      sam: ["SQL"],
    },
  },
  {
    id: "ux", family: "UX design",
    required: ["Figma", "Prototyping", "User research", "Design systems", "Portfolio demonstrating UX process", "Usability testing"],
    preferred: ["HTML/CSS", "Accessibility (WCAG)", "Framer"],
    expect: {
      required: ["Figma", "Prototyping", "User research", "Design systems", "Usability testing"],
      preferred: ["HTML", "CSS", "Accessibility", "Framer"],
      alex: ["HTML", "CSS"],
      sam: [],
    },
  },
  {
    id: "embedded", family: "Embedded",
    required: ["C/C++", "RTOS (FreeRTOS, Zephyr)", "I2C, SPI, UART", "Oscilloscope", "Git"],
    preferred: ["CAN bus", "Python", "Yocto"],
    expect: {
      required: ["C", "C++", "RTOS (FreeRTOS, Zephyr)", "I2C", "SPI", "UART", "Oscilloscope", "Git"],
      preferred: ["CAN bus", "Python", "Yocto"],
      alex: ["C++", "Python"],
      sam: ["C", "C++", "RTOS (FreeRTOS, Zephyr)", "I2C", "SPI", "UART", "Git", "CAN bus", "Python"],
    },
  },
  {
    id: "robotics", family: "Robotics",
    required: ["ROS or ROS 2", "C++", "Python", "Linux", "Computer vision (OpenCV)"],
    preferred: ["Gazebo", "SLAM", "Docker"],
    expect: {
      required: ["ROS or ROS 2", "C++", "Python", "Linux", "Computer vision (OpenCV)"],
      preferred: ["Gazebo", "SLAM", "Docker"],
      alex: ["C++", "Python", "Docker"],
      sam: ["ROS or ROS 2", "C++", "Python", "Linux", "Computer vision (OpenCV)", "Gazebo", "Docker"],
    },
  },
  {
    id: "fullstack", family: "Full stack",
    required: ["Node.js", "React", "PostgreSQL", "TypeScript", "AWS or GCP"],
    preferred: ["Docker", "GraphQL", "Redis", "Tailwind", "Prisma"],
    expect: {
      required: ["Node.js", "React", "PostgreSQL", "TypeScript", "AWS or GCP"],
      preferred: ["Docker", "GraphQL", "Redis", "Tailwind", "Prisma"],
      alex: ["Node.js", "React", "PostgreSQL", "TypeScript", "AWS or GCP", "Docker", "Tailwind", "Prisma"],
      sam: ["AWS or GCP", "Docker"],
    },
  },
  {
    id: "devops", family: "DevOps",
    required: ["Linux", "Bash scripting", "Docker", "CI/CD", "Terraform or CloudFormation", "Git"],
    preferred: ["Kubernetes (K8s)", "Prometheus", "Python", "Monitoring and observability"],
    expect: {
      required: ["Linux", "Bash scripting", "Docker", "CI/CD", "Terraform or CloudFormation", "Git"],
      preferred: ["Kubernetes", "Prometheus", "Python", "Monitoring", "observability"],
      alex: ["Docker", "Prometheus", "Python", "Monitoring", "observability"],
      sam: ["Linux", "Bash scripting", "Docker", "CI/CD", "Git", "Python"],
    },
  },
  {
    id: "qa", family: "QA",
    required: ["Selenium or Cypress or Playwright", "Test automation", "JavaScript or Python", "API testing (Postman)", "Bug tracking (Jira)"],
    preferred: ["CI/CD", "Java", "Performance testing (JMeter, k6)"],
    expect: {
      required: ["Selenium or Cypress or Playwright", "Test automation", "JavaScript or Python", "API testing", "Bug tracking"],
      preferred: ["CI/CD", "Java", "Performance testing (JMeter, k6)"],
      alex: ["JavaScript or Python", "Java", "Performance testing (JMeter, k6)"],
      sam: ["JavaScript or Python", "CI/CD"],
    },
  },
  {
    id: "security", family: "Security",
    required: ["Security fundamentals", "Python", "Linux", "Networking (TCP/IP)", "SIEM tools", "Security+ certification"],
    preferred: ["Wireshark", "Bash"],
    expect: {
      required: ["Security fundamentals", "Python", "Linux", "Networking", "SIEM", "Security+ certification"],
      preferred: ["Wireshark", "Bash"],
      alex: ["Python"],
      sam: ["Python", "Linux", "Bash"],
    },
  },
  {
    id: "generic", family: "Backend (noisy list)",
    required: ["Go", "Kubernetes", "gRPC", "PostgreSQL", "Postgres", "Strong problem-solving skills", "Attention to detail", "JS"],
    preferred: ["TypeScript", "Terraform", "Experience with Google Cloud (GCP)"],
    expect: {
      required: ["Go", "Kubernetes", "gRPC", "PostgreSQL", "JS"],
      preferred: ["TypeScript", "Terraform", "Google Cloud"],
      alex: ["Go", "PostgreSQL", "JS", "TypeScript", "Google Cloud"],
      sam: [],
    },
  },
  {
    id: "java-enterprise", family: "Backend (Java)",
    required: ["Java 17", "Spring", "Hibernate/JPA", "Oracle database", "JavaScript"],
    preferred: ["Angular", "Maven"],
    expect: {
      required: ["Java", "Spring", "Hibernate", "JPA", "Oracle database", "JavaScript"],
      preferred: ["Angular", "Maven"],
      alex: ["Java", "Spring", "JavaScript"],
      sam: [],
    },
  },
];
