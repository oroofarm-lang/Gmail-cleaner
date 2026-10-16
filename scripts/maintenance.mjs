import { maintenance } from "./maintenance-store.mjs";
try {
  const [command, file, generation, ...extra] = process.argv.slice(2);
  if (
    !file ||
    extra.length ||
    (command !== "status" && generation === undefined)
  )
    throw Error("Invalid command.");
  console.log(
    JSON.stringify(
      maintenance(
        file,
        command,
        generation === undefined ? undefined : Number(generation),
      ),
    ),
  );
} catch {
  console.error(
    "Maintenance command rejected. Verify the local SQLite path, command and current generation. No operation tickets were cleared.",
  );
  process.exitCode = 1;
}
