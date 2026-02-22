// 題目: サーバーサイドアクション（APIロジック）
"use server";

import { supabase } from "@/lib/supabase";

type Role =
  | "Malware"
  | "Stable"
  | "Scanner"
  | "Scraper"
  | "Trojan"
  | "Backdoor";

// 題目: ゲーム開始とハルシネーション設定
export async function startGameAPI(
  roomId: string,
  roleConfig: Record<Role, number>,
  players: any[],
) {
  const rolePool: Role[] = [];
  (Object.keys(roleConfig) as Role[]).forEach((role) => {
    for (let i = 0; i < roleConfig[role]; i++) rolePool.push(role as Role);
  });

  const shuffledRoles = [...rolePool].sort(() => Math.random() - 0.5);
  const hallucinationIndex = Math.floor(Math.random() * players.length);
  const availableRoles: Role[] = [
    "Malware",
    "Stable",
    "Scanner",
    "Scraper",
    "Trojan",
    "Backdoor",
  ];

  const playerUpdates = players.map((player, index) => {
    const trueRole = shuffledRoles[index];
    let perceivedRole = trueRole;
    let isHallucinating = false;

    if (index === hallucinationIndex) {
      isHallucinating = true;
      const fakeRoles = availableRoles.filter((r) => r !== trueRole);
      perceivedRole = fakeRoles[Math.floor(Math.random() * fakeRoles.length)];
    }

    return {
      id: player.id,
      room_id: roomId,
      name: player.name,
      is_host: player.is_host,
      role: trueRole,
      perceived_role: perceivedRole,
      is_hallucinating: isHallucinating,
      is_ready: false,
      action_target: null,
      vote_target: null,
      skip_vote: false,
      extend_vote: false,
      action_result: null,
    };
  });

  await supabase.from("players").upsert(playerUpdates);
  await supabase
    .from("rooms")
    .update({
      status: "night",
      center_cards: shuffledRoles.slice(players.length),
      result_data: null,
    })
    .eq("id", roomId);
}

// 題目: 夜の行動処理と幻覚データの生成
export async function submitNightActionAPI(
  roomId: string,
  playerId: string,
  targetId: string,
) {
  const { data: roomData } = await supabase
    .from("rooms")
    .select("center_cards")
    .eq("id", roomId)
    .single();
  const { data: player } = await supabase
    .from("players")
    .select("*")
    .eq("id", playerId)
    .single();
  const { data: allPlayers } = await supabase
    .from("players")
    .select("*")
    .eq("room_id", roomId);

  if (!player || !roomData || !allPlayers) return;

  let resultMsg = null;
  const updateData: any = { is_ready: true };
  const fakeRoles: Role[] = [
    "Malware",
    "Stable",
    "Scanner",
    "Scraper",
    "Trojan",
    "Backdoor",
  ];

  if (player.is_hallucinating) {
    if (player.perceived_role === "Stable" && targetId) {
      updateData.action_target = targetId;
      resultMsg = "対象をマークしました。";
    } else if (player.perceived_role === "Scanner" && targetId) {
      if (targetId === "center") {
        const fake1 = fakeRoles[Math.floor(Math.random() * fakeRoles.length)];
        const fake2 = fakeRoles[Math.floor(Math.random() * fakeRoles.length)];
        resultMsg = `スキャン完了: 中央のデータは【${fake1}】と【${fake2}】です。`;
      } else {
        const fakeRole =
          fakeRoles[Math.floor(Math.random() * fakeRoles.length)];
        resultMsg = `スキャン完了: 対象の役職は【${fakeRole}】です。`;
      }
    } else if (player.perceived_role === "Scraper" && targetId) {
      updateData.action_target = targetId;
      const fakeRole = fakeRoles[Math.floor(Math.random() * fakeRoles.length)];
      resultMsg = `データを奪取しました。現在のあなたの役職は【${fakeRole}】です。`;
    }
  } else {
    if (player.perceived_role === "Stable" && targetId) {
      updateData.action_target = targetId;
      resultMsg = "対象をマークしました。";
    } else if (player.perceived_role === "Scanner" && targetId) {
      if (targetId === "center") {
        resultMsg = `スキャン完了: 中央のデータは【${roomData.center_cards[0]}】と【${roomData.center_cards[1]}】です。`;
      } else {
        const targetPlayer = allPlayers.find((p) => p.id === targetId);
        resultMsg = `スキャン完了: 対象の役職は【${targetPlayer?.role}】です。`;
      }
    } else if (player.perceived_role === "Scraper" && targetId) {
      const targetPlayer = allPlayers.find((p) => p.id === targetId);
      updateData.action_target = targetId;
      resultMsg = `データを奪取しました。現在のあなたの役職は【${targetPlayer?.role}】です。`;
    }
  }

  if (resultMsg) updateData.action_result = resultMsg;
  await supabase.from("players").update(updateData).eq("id", playerId);
}

// 題目: 結果計算処理
export async function calculateResultAPI(roomId: string) {
  const { data: players } = await supabase
    .from("players")
    .select("*")
    .eq("room_id", roomId);
  if (!players) return;

  const finalRoles: Record<string, Role | undefined> = {};
  players.forEach((p) => (finalRoles[p.id] = p.role));

  const scraper = players.find(
    (p) => p.role === "Scraper" && !p.is_hallucinating,
  );
  if (scraper && scraper.action_target) {
    const targetRole = finalRoles[scraper.action_target];
    finalRoles[scraper.action_target] = "Scraper";
    finalRoles[scraper.id] = targetRole;
  }

  const voteCounts: Record<string, number> = {};
  players.forEach((p) => {
    if (p.vote_target)
      voteCounts[p.vote_target] = (voteCounts[p.vote_target] || 0) + 1;
  });

  let maxVotes = 0;
  let candidates: string[] = [];
  Object.entries(voteCounts).forEach(([id, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
      candidates = [id];
    } else if (count === maxVotes) candidates.push(id);
  });

  let purgedId = candidates[0];
  let isPeacefulEnd = false;

  const threshold = Math.floor(players.length / 2) + 1;
  if (voteCounts["NO_THREAT"] >= threshold) {
    isPeacefulEnd = true;
    purgedId = "NO_THREAT";
  } else {
    if (candidates.length > 1) {
      const actionCounts: Record<string, number> = {};
      players.forEach((p) => {
        if (
          p.action_target &&
          candidates.includes(p.action_target) &&
          finalRoles[p.id] === "Stable"
        ) {
          actionCounts[p.action_target] =
            (actionCounts[p.action_target] || 0) + 1;
        }
      });
      let maxActionVotes = -1;
      Object.entries(actionCounts).forEach(([id, count]) => {
        if (count > maxActionVotes && candidates.includes(id)) {
          maxActionVotes = count;
          purgedId = id;
        }
      });

      if (purgedId === "NO_THREAT" && candidates.length > 1) {
        const playerCandidates = candidates.filter((c) => c !== "NO_THREAT");
        if (playerCandidates.length > 0) purgedId = playerCandidates[0];
      }
    }
    if (purgedId === "NO_THREAT") isPeacefulEnd = true;
  }

  const purgedPlayer = isPeacefulEnd
    ? null
    : players.find((p) => p.id === purgedId);
  const purgedFinalRole = purgedPlayer ? finalRoles[purgedPlayer.id] : null;

  let winTeam = "";
  let winMessage = "";
  let bgColor = "";
  let winningFaction: "STABLE" | "MALWARE" | "TROJAN" = "STABLE";

  if (isPeacefulEnd) {
    const hasMalware = players.some((p) => finalRoles[p.id] === "Malware");
    if (hasMalware) {
      winningFaction = "MALWARE";
      winTeam = "MALWARE WINS";
      winMessage =
        "システムにマルウェアが潜伏していました！異常なし判定（平和村）は偽装され、システムは乗っ取られました。";
      bgColor = "border-red-500 text-red-500";
    } else {
      winningFaction = "STABLE";
      winTeam = "STABLE MODELS WIN";
      winMessage =
        "システム内にマルウェアは検出されませんでした。オールクリア（平和村）達成です！";
      bgColor = "border-cyan-400 text-cyan-400";
    }
  } else {
    if (purgedFinalRole === "Trojan") {
      winningFaction = "TROJAN";
      winTeam = "TROJAN WINS";
      winMessage =
        "トロイがパージされました。システムは内部から爆破され、トロイの単独勝利です。";
      bgColor = "border-purple-500 text-purple-400";
    } else if (purgedFinalRole === "Malware") {
      winningFaction = "STABLE";
      winTeam = "STABLE MODELS WIN";
      winMessage =
        "マルウェアのパージに成功しました。システムは正常化されました。";
      bgColor = "border-cyan-400 text-cyan-400";
    } else {
      winningFaction = "MALWARE";
      winTeam = "MALWARE WINS";
      winMessage = "マルウェアは生き残りました。システムは乗っ取られました。";
      bgColor = "border-red-500 text-red-500";
    }
  }

  const playerResults = players.map((p) => {
    const finalRole = finalRoles[p.id];
    let isWinner = false;
    if (winningFaction === "TROJAN") {
      isWinner = finalRole === "Trojan";
    } else if (winningFaction === "MALWARE") {
      isWinner = finalRole === "Malware" || finalRole === "Backdoor";
    } else if (winningFaction === "STABLE") {
      const hasMalware = players.some((pl) => finalRoles[pl.id] === "Malware");
      isWinner =
        finalRole === "Stable" ||
        finalRole === "Scanner" ||
        finalRole === "Scraper" ||
        (finalRole === "Backdoor" && isPeacefulEnd && !hasMalware);
    }

    let voteTargetName = "未投票";
    if (p.vote_target === "NO_THREAT") {
      voteTargetName = "SYSTEM ALL CLEAR";
    } else if (p.vote_target) {
      const target = players.find((tp) => tp.id === p.vote_target);
      if (target) voteTargetName = target.name;
    }

    return {
      id: p.id,
      name: p.name,
      role: p.role,
      finalRole,
      isWinner,
      voteTargetName,
      isHallucinating: p.is_hallucinating,
      perceivedRole: p.perceived_role,
    };
  });

  const resultData = {
    purgedPlayerName: purgedPlayer?.name || null,
    purgedFinalRole,
    candidates,
    winTeam,
    winMessage,
    bgColor,
    playerResults,
    isPeacefulEnd,
  };

  await supabase
    .from("rooms")
    .update({ status: "end", result_data: resultData })
    .eq("id", roomId);
}
