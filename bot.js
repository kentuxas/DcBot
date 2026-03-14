
const { Client, GatewayIntentBits } = require("discord.js");
const { QuickDB } = require("quick.db");
const express = require("express");
const ms = require("ms");
const config = require("./config.json");

const db = new QuickDB();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites
  ]
});

const invites = new Map();

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  client.guilds.cache.forEach(async guild => {
    const guildInvites = await guild.invites.fetch();
    invites.set(guild.id, guildInvites);
  });
});

client.on("guildMemberAdd", async member => {

  const ageDays = (Date.now() - member.user.createdTimestamp) / 86400000;
  if(ageDays < config.fakeAccountDays) return;

  const newInvites = await member.guild.invites.fetch();
  const oldInvites = invites.get(member.guild.id);

  const invite = newInvites.find(i => oldInvites.get(i.code)?.uses < i.uses);
  if(!invite) return;

  const inviter = invite.inviter;

  await db.add(`invites_${member.guild.id}_${inviter.id}`,1);
  await db.set(`invited_${member.guild.id}_${member.id}`, inviter.id);

  const total = await db.get(`invites_${member.guild.id}_${inviter.id}`);

  if(config.rewardRoles){
    for(const amount in config.rewardRoles){
      if(total >= amount){
        const role = member.guild.roles.cache.get(config.rewardRoles[amount]);
        if(role){
          const user = await member.guild.members.fetch(inviter.id);
          user.roles.add(role).catch(()=>{});
        }
      }
    }
  }

  invites.set(member.guild.id,newInvites);
});

client.on("guildMemberRemove", async member => {
  const inviter = await db.get(`invited_${member.guild.id}_${member.id}`);
  if(!inviter) return;
  await db.sub(`invites_${member.guild.id}_${inviter}`,1);
});

client.on("interactionCreate", async interaction => {
  if(!interaction.isChatInputCommand()) return;

  if(interaction.commandName === "invites"){
    const invites = await db.get(`invites_${interaction.guild.id}_${interaction.user.id}`) || 0;
    interaction.reply(`📨 You have **${invites} invites**.`);
  }

  if(interaction.commandName === "leaderboard"){
    const data = await db.all();

    const invites = data
      .filter(x => x.id.startsWith(`invites_${interaction.guild.id}`))
      .sort((a,b)=>b.value-a.value)
      .slice(0,10);

    let text = invites.map((x,i)=>{
      const id = x.id.split("_")[2];
      return `${i+1}. <@${id}> — ${x.value}`;
    }).join("\n");

    interaction.reply(`🏆 **Invite Leaderboard**\n\n${text || "No invites yet."}`);
  }

  if(interaction.commandName === "invite-giveaway"){

    const prize = interaction.options.getString("prize");
    const duration = interaction.options.getString("duration");

    const end = Date.now() + ms(duration);

    await db.set("invite_giveaway",{prize,end});

    interaction.reply(`🎉 **Invite Giveaway Started!**
Prize: ${prize}
Ends: <t:${Math.floor(end/1000)}:R>
Winner: Person with most invites`);

  }

});

setInterval(async ()=>{

  const giveaway = await db.get("invite_giveaway");
  if(!giveaway) return;

  if(Date.now() < giveaway.end) return;

  const data = await db.all();

  const invites = data
   .filter(x=>x.id.startsWith("invites"))
   .sort((a,b)=>b.value-a.value);

  if(!invites.length) return;

  const winner = invites[0].id.split("_")[2];

  const channel = client.channels.cache.get(config.logChannel);

  if(channel){
    channel.send(`🏆 **Invite Giveaway Ended**
Winner: <@${winner}>
Prize: ${giveaway.prize}`);
  }

  db.delete("invite_giveaway");

},60000);


/* Dashboard */
const app = express();

app.get("/", async (req,res)=>{

  const data = await db.all();

  const invites = data
   .filter(x=>x.id.startsWith("invites"))
   .sort((a,b)=>b.value-a.value)
   .slice(0,10);

  let html = "<h1>Invite Leaderboard</h1>";

  invites.forEach((u,i)=>{
    html += `<p>${i+1}. ${u.id} — ${u.value}</p>`;
  });

  res.send(html);

});

app.listen(config.dashboardPort, ()=>{
  console.log("Dashboard running on port " + config.dashboardPort);
});

client.login(config.token);
