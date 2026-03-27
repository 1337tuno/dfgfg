const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType } = require('discord.js');
const dotenv = require('dotenv');
const express = require('express');

dotenv.config();

// ================================
//  Configuration
// ================================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional – if not set, commands are global
const PORT = process.env.PORT || 3000;

// Category where tickets will be created
const TICKET_CATEGORY_ID = '1486177708168843417';

// Roles that can see all tickets (add your role IDs)
const ALLOWED_ROLE_IDS = [
  '1465627226639827039',
  '1465627423583240193',
  '1486176548644982814',
  '1486176813599424512',
  '1465626346045575335'
];

// ================================
//  Discord Client
// ================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ================================
//  Register Slash Commands
// ================================
const commands = [
  new SlashCommandBuilder()
    .setName('uber-order')
    .setDescription('Create a new Uber Eats group order ticket')
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  try {
    console.log('Registering slash commands...');
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log(`Commands registered for guild ${GUILD_ID}`);
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log('Commands registered globally (may take up to an hour)');
    }
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
}

// ================================
//  Helper: Check if user already has a ticket
// ================================
async function userHasOpenTicket(userId, categoryId) {
  const category = await client.channels.fetch(categoryId);
  if (!category || category.type !== ChannelType.GuildCategory) return false;

  const ticketChannels = category.children.cache.filter(ch => ch.type === ChannelType.GuildText);
  return ticketChannels.some(ch => ch.topic?.includes(userId) || ch.name.includes(userId));
}

// ================================
//  Helper: Create ticket channel
// ================================
async function createTicketChannel(interaction, formData) {
  const { user, guild } = interaction;
  const category = await guild.channels.fetch(TICKET_CATEGORY_ID);
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error('Ticket category not found or invalid.');
  }

  // Check for existing open ticket
  const hasTicket = await userHasOpenTicket(user.id, TICKET_CATEGORY_ID);
  if (hasTicket) {
    throw new Error('You already have an open ticket. Please close it before creating a new one.');
  }

  // Create channel
  const channelName = `uber-${user.username.toLowerCase()}-${Date.now()}`;
  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Ticket for ${user.tag} (ID: ${user.id})`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      ...ALLOWED_ROLE_IDS.map(roleId => ({
        id: roleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AddReactions,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks
        ]
      })),
      {
        id: user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AddReactions,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks
        ]
      },
      {
        id: client.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels
        ]
      }
    ]
  });

  // Build embed with order details
  const embed = new EmbedBuilder()
    .setTitle('🍔 Uber Eats Group Order')
    .setColor(0x00FF00)
    .setDescription('Please fill in the order details below.')
    .addFields(
      { name: 'Order Details', value: formData.orderDetails || '*Not provided*', inline: false },
      { name: 'Address', value: formData.address || '*Not provided*', inline: true },
      { name: 'Payment Method', value: formData.paymentMethod || '*Not provided*', inline: true },
      { name: 'Additional Notes', value: formData.additionalNotes || '*None*', inline: false }
    )
    .setFooter({ text: `Ticket created by ${user.tag}` })
    .setTimestamp();

  const closeButton = new ButtonBuilder()
    .setCustomId('close_ticket')
    .setLabel('Close Ticket')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(closeButton);

  // Send initial message with embed and button
  await ticketChannel.send({
    content: `<@&${ALLOWED_ROLE_IDS.join('> <@&')}> New ticket created!`,
    embeds: [embed],
    components: [row]
  });

  // Also mention the user
  await ticketChannel.send(`<@${user.id}>`);

  return ticketChannel;
}

// ================================
//  Modal Handler
// ================================
async function handleModalSubmit(interaction) {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId !== 'uberOrderModal') return;

  await interaction.deferReply({ ephemeral: true });

  try {
    // Extract form data
    const orderDetails = interaction.fields.getTextInputValue('orderDetails');
    const address = interaction.fields.getTextInputValue('address');
    const paymentMethod = interaction.fields.getTextInputValue('paymentMethod');
    const additionalNotes = interaction.fields.getTextInputValue('additionalNotes');

    const formData = {
      orderDetails,
      address,
      paymentMethod,
      additionalNotes
    };

    const ticketChannel = await createTicketChannel(interaction, formData);
    await interaction.editReply({ content: `✅ Ticket created: ${ticketChannel}`, ephemeral: true });
  } catch (error) {
    console.error('Error creating ticket:', error);
    await interaction.editReply({ content: `❌ Failed to create ticket: ${error.message}`, ephemeral: true });
  }
}

// ================================
//  Button Handler (Close Ticket)
// ================================
async function handleButtonInteraction(interaction) {
  if (!interaction.isButton()) return;
  if (interaction.customId !== 'close_ticket') return;

  const channel = interaction.channel;
  const member = interaction.member;
  const userId = member.id;

  // Permission check: allow if user is ticket creator OR has any allowed role
  const isCreator = channel.topic?.includes(userId);
  const hasAllowedRole = ALLOWED_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));

  if (!isCreator && !hasAllowedRole) {
    return interaction.reply({ content: '❌ You do not have permission to close this ticket.', ephemeral: true });
  }

  await interaction.reply({ content: '🔒 Closing ticket...', ephemeral: true });
  setTimeout(async () => {
    try {
      await channel.delete();
    } catch (err) {
      console.error('Failed to delete channel:', err);
    }
  }, 1000);
}

// ================================
//  Slash Command Handler
// ================================
async function handleSlashCommand(interaction) {
  if (!interaction.isCommand()) return;
  if (interaction.commandName !== 'uber-order') return;

  // Create modal
  const modal = new ModalBuilder()
    .setCustomId('uberOrderModal')
    .setTitle('Uber Eats Group Order');

  const orderDetailsInput = new TextInputBuilder()
    .setCustomId('orderDetails')
    .setLabel('Order Details (e.g., items, restaurant)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('2x Big Mac, 1x Fries, etc.');

  const addressInput = new TextInputBuilder()
    .setCustomId('address')
    .setLabel('Delivery Address')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('123 Main St, Apt 4B');

  const paymentMethodInput = new TextInputBuilder()
    .setCustomId('paymentMethod')
    .setLabel('Payment Method')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('Venmo @username, PayPal, etc.');

  const notesInput = new TextInputBuilder()
    .setCustomId('additionalNotes')
    .setLabel('Additional Notes (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder('Any special instructions...');

  modal.addComponents(
    new ActionRowBuilder().addComponents(orderDetailsInput),
    new ActionRowBuilder().addComponents(addressInput),
    new ActionRowBuilder().addComponents(paymentMethodInput),
    new ActionRowBuilder().addComponents(notesInput)
  );

  await interaction.showModal(modal);
}

// ================================
//  Web Server (for Render)
// ================================
const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

// ================================
//  Bot Ready Event
// ================================
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
  console.log('Bot is ready!');
});

// ================================
//  Event Handlers
// ================================
client.on('interactionCreate', handleSlashCommand);
client.on('interactionCreate', handleModalSubmit);
client.on('interactionCreate', handleButtonInteraction);

// ================================
//  Login
// ================================
client.login(TOKEN).catch(err => {
  console.error('Failed to login:', err);
  process.exit(1);
});