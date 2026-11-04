import { API_URL } from "./servers";

// Fails the run when the app called the api where no test mocked it and the stub has no route.
export default async function unmatched() {
  const calls: string[] = await (await fetch(`${API_URL}/__test/unmatched`)).json();
  if (calls.length > 0) throw new Error(`Unmocked api calls:\n${[...new Set(calls)].join("\n")}`);
}
