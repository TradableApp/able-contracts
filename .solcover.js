// Contracts under contracts/test/ are fixtures, not shipped code: AbleTokenV2 exists to be
// upgraded to, AbleTokenDeployedBaseline only to be compared against. Instrumenting them
// reports them as uncovered and drags the aggregate well below the real figure for the one
// contract that actually ships.
module.exports = {
  skipFiles: ["test/"],
};
