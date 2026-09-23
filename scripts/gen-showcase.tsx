import { ABDUCTED } from "../src/lib/demo/abducted";
import { computeGrade } from "../src/lib/bridge/grade";
import { writeFileSync } from "fs";
const r: any = JSON.parse(JSON.stringify(ABDUCTED.report));
// Strong-but-believable metrics -> A- / B+
r.metrics = { ...r.metrics,
  objective_coverage_pct: 91, technique_breadth: 11, efficiency_pct: 78,
  ukc_progression: 90, ukc_coverage_pct: 88, weakness_breadth: 4,
  methodology_coverage_pct: 92, focus_discipline_pct: 83, recovery_median_ms: 110000,
  stealth_score: 81,
};
// Flattering ghost: mostly ahead/on-time, a couple off-path wins, one teachable late pivot.
r.ghost = {
  time_lost_ms: 8 * 60000, human_wins: 4,
  items: [
    { objective:"enumerate_exposed_services", verdict:"ahead", unlock_seq:3, actual_seq:2, lag_ms:0, note:"You did enumerate exposed services before its prerequisite surfaced — ahead of the optimal line." },
    { objective:"enumerate_smb_shares", verdict:"on_time", unlock_seq:4, actual_seq:5, lag_ms:0, note:"On the optimal line for enumerate smb shares." },
    { objective:"exploit_print_injection", verdict:"ahead", unlock_seq:9, actual_seq:8, lag_ms:0, note:"You did exploit print injection before its prerequisite surfaced — ahead of the optimal line." },
    { objective:"get_foothold", verdict:"on_time", unlock_seq:10, actual_seq:10, lag_ms:0, note:"On the optimal line for get foothold." },
    { objective:"discover_offsite_backup_creds", verdict:"off_path_win", unlock_seq:null, actual_seq:14, lag_ms:0, note:"You reached the offsite backup creds via your own route — off the intended path." },
    { objective:"capture_user_flag", verdict:"on_time", unlock_seq:16, actual_seq:16, lag_ms:0, note:"On the optimal line for capture the user flag." },
    { objective:"escalate_to_root", verdict:"ahead", unlock_seq:26, actual_seq:24, lag_ms:0, note:"You did escalate to root before its prerequisite surfaced — ahead of the optimal line." },
    { objective:"audit_share_permissions", verdict:"skipped", unlock_seq:5, actual_seq:null, lag_ms:0, note:"Unlocked at step 5; never attempted — the optimal line takes it." },
    { objective:"abuse_sudo_rule", verdict:"late_pivot", unlock_seq:11, actual_seq:16, lag_ms:8*60000, note:"Unlocked at step 11 but you acted at step 16 — the optimal line pivots here sooner." },
  ],
};
const g = computeGrade(r);
writeFileSync("C:/Users/Tiago Peter/Claude/Projects/watcher-site/showcase.report.json", JSON.stringify(r));
console.log("grade:", g.letter, g.score.toFixed(1), "| breadth stored:", r.metrics.technique_breadth, "| wins:", r.ghost.human_wins, "| episodes:", r.episodes.length);
