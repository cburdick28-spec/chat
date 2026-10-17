// Topic pool for the auto-picked Shorts. Shared by the server (what to search)
// and the client (the "For you" picker). A topic is also its own search text.
export const TOPIC_GROUPS: { label: string; topics: string[] }[] = [
  {
    label: "Sports",
    topics: [
      "basketball highlights",
      "soccer skills",
      "football touchdowns",
      "skateboarding tricks",
      "parkour",
      "mma knockouts",
      "tennis trick shots",
      "golf trick shots",
      "cricket sixes",
      "formula 1 onboard",
      "surfing wipeouts",
      "gymnastics",
    ],
  },
  {
    label: "Funny",
    topics: [
      "funny fails",
      "harmless pranks",
      "stand up comedy clips",
      "funny animals",
      "wholesome moments",
      "sketch comedy",
    ],
  },
  {
    label: "Animals",
    topics: [
      "cute puppies",
      "cats being weird",
      "wildlife encounters",
      "aquarium fish",
      "birds",
      "baby animals",
    ],
  },
  {
    label: "Food",
    topics: [
      "street food",
      "cooking hacks",
      "baking",
      "ramen",
      "BBQ",
      "desserts",
    ],
  },
  {
    label: "Gaming",
    topics: [
      "gaming clips",
      "minecraft builds",
      "speedruns",
      "fortnite clips",
      "retro games",
      "game dev",
    ],
  },
  {
    label: "Tech & science",
    topics: [
      "cool tech gadgets",
      "science experiments",
      "space",
      "AI demos",
      "robots",
      "engineering",
    ],
  },
  {
    label: "Making stuff",
    topics: [
      "drawing time lapse",
      "3d printing",
      "woodworking",
      "diy builds",
      "magic tricks",
      "pottery",
    ],
  },
  {
    label: "Music & dance",
    topics: [
      "guitar covers",
      "piano",
      "drum covers",
      "beatbox",
      "dance choreography",
      "singing covers",
    ],
  },
  {
    label: "Cars",
    topics: ["supercars", "drifting", "car restoration", "motorcycles"],
  },
  {
    label: "Life",
    topics: [
      "travel",
      "oddly satisfying",
      "life hacks",
      "fitness",
      "history facts",
      "optical illusions",
      "architecture",
      "street photography",
    ],
  },
];

export const ALL_TOPICS: string[] = TOPIC_GROUPS.flatMap((g) => g.topics);
export const MAX_INTERESTS = 12;
