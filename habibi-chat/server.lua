local channels = {
    me = { label = 'ME', color = { 98, 225, 205 }, range = 20 },
    ['do'] = { label = 'DO', color = { 98, 225, 205 }, range = 20 },
    ooc = { label = 'OOC', color = { 203, 213, 225 }, range = 20 },
    try = { label = 'TRY', color = { 98, 225, 205 }, range = 20 },
}

local lastMessage = {}
local lastReport = {}
local lastSuggestionRequest = {}
local commandSuggestions = {
    { name = 'me', help = 'Opisz akcję postaci', params = { { name = 'akcja' } } },
    { name = 'do', help = 'Opisz sytuację lub otoczenie', params = { { name = 'opis' } } },
    { name = 'try', help = 'Spróbuj wykonać akcję (losowo: udane / nieudane)', params = { { name = 'akcja' } } },
    { name = 'ooc', help = 'Lokalna wiadomość poza postacią', params = { { name = 'wiadomość' } } },
    { name = 'report', help = 'Wyślij zgłoszenie do administracji', params = { { name = 'treść' } } },
}

local function addMessage(target, message)
    TriggerClientEvent('chat:addMessage', target, message)
end

exports('addMessage', addMessage)

local function cleanText(text)
    if type(text) ~= 'string' or #text > 1024 then return nil end
    text = text:gsub('%c', ' '):match('^%s*(.-)%s*$')
    if text == '' then return nil end
    return text
end

local function getCharacter(source)
    if GetResourceState('qbx_core') ~= 'started' then return nil end
    local player = exports.qbx_core:GetPlayer(source)
    local data = player and player.PlayerData
    if not data or not data.charinfo then return nil end
    return data
end

local function hasCharacter(source)
    return getCharacter(source) ~= nil
end


local function sendLocal(source, channelKey, rawText)
    if source <= 0 then return end
    local channel = channels[channelKey]
    local text = cleanText(rawText)
    if not channel or not text then return end
    if not hasCharacter(source) then
        addMessage(source, { label = 'SYSTEM', color = { 148, 163, 184 }, args = { 'Najpierw wybierz postać - wiadomość nie została wysłana.' } })
        return
    end
    local ped = GetPlayerPed(source)
    if ped == 0 then return end

    local now = GetGameTimer()
    if lastMessage[source] and now - lastMessage[source] < 800 then
        -- wczesniej wiadomosc znikala bez sladu; teraz autor wie, ze trzeba ja powtorzyc
        addMessage(source, { label = 'SYSTEM', color = { 148, 163, 184 }, args = { 'Za szybko - poczekaj chwilę i wyślij ponownie.' } })
        return
    end
    lastMessage[source] = now

    local position = GetEntityCoords(ped)
    local bucket = GetPlayerRoutingBucket(source)
    local sender = ('[%d]'):format(source)
    if channelKey == 'ooc' then
        sender = ('[%d] %s'):format(source, GetPlayerName(source) or 'Gracz')
    end
    local message = { label = channel.label, color = channel.color, args = { sender, text } }
    if channelKey == 'me' then message.args = { ('* [%d] %s'):format(source, text) } end
    if channelKey == 'do' then message.args = { ('* [%d] %s'):format(source, text) } end
    local success
    if channelKey == 'try' then
        success = math.random(1, 2) == 1
        message.color = success and { 74, 222, 128 } or { 248, 113, 113 }
        -- wynik idzie osobnym polem: czat odslania go po losowaniu, razem z dymkiem nad glowa
        message.args = { ('* [%d] próbuje %s'):format(source, text) }
        message.result = success and 'ok' or 'fail'
    end
    for _, id in ipairs(GetPlayers()) do
        local target = tonumber(id)
        if GetPlayerRoutingBucket(target) == bucket then
            local targetPed = GetPlayerPed(target)
            if targetPed ~= 0 and #(GetEntityCoords(targetPed) - position) <= channel.range then
                addMessage(target, message)
                if channelKey == 'me' or channelKey == 'do' or channelKey == 'try' then
                    TriggerClientEvent('rpchat:overhead', target, source, channelKey, text, success)
                end
            end
        end
    end
end

local function sendReport(source, rawText)
    if source <= 0 then return end
    local text = cleanText(rawText)
    if not text then return end
    if not hasCharacter(source) then return end
    local now = GetGameTimer()
    if lastReport[source] and now - lastReport[source] < 30000 then
        addMessage(source, { label = 'REPORT', color = { 253, 186, 116 }, args = { 'System', 'Następny report możesz wysłać za chwilę.' } })
        return
    end
    lastReport[source] = now

    local report = {
        label = 'REPORT', color = { 253, 186, 116 },
        args = { ('[ID %d]'):format(source), text },
    }
    addMessage(source, { label = 'REPORT', color = report.color, args = { 'Ty', text } })
    for _, id in ipairs(GetPlayers()) do
        local target = tonumber(id)
        if target ~= source and IsPlayerAceAllowed(target, 'rpchat.admin') then
            addMessage(target, report)
        end
    end
end

RegisterNetEvent('rpchat:submit', function(mode, text)
    if mode == 'report' then
        sendReport(source, text)
    elseif mode == 'ic' then
        sendLocal(source, 'ooc', text)
    elseif channels[mode] then
        sendLocal(source, mode, text)
    end
end)

RegisterNetEvent('rpchat:say', function(text)
    sendLocal(source, 'ooc', text)
end)

for _, suggestion in ipairs(commandSuggestions) do
    local name = suggestion.name
    if GetConvar('rpchat:enable_' .. name, 'true') == 'true' then
        RegisterCommand(name, function(source, args)
            local text = table.concat(args, ' ')
            if name == 'report' then sendReport(source, text) else sendLocal(source, name, text) end
        end, false)
    end
end

RegisterNetEvent('rpchat:requestSuggestions', function()
    local player = source
    local now = GetGameTimer()
    if lastSuggestionRequest[player] and now - lastSuggestionRequest[player] < 750 then return end
    lastSuggestionRequest[player] = now

    local suggestions = {}
    for _, suggestion in ipairs(commandSuggestions) do
        if GetConvar('rpchat:enable_' .. suggestion.name, 'true') == 'true' then
            suggestions[#suggestions + 1] = {
                name = '/' .. suggestion.name, help = suggestion.help, params = suggestion.params,
            }
        end
    end
    for _, command in ipairs(GetRegisteredCommands()) do
        local name = command.name
        if name ~= 'rpchat_open' and name ~= 'ic' and IsPlayerAceAllowed(player, 'command.' .. name) then
            suggestions[#suggestions + 1] = { name = '/' .. name }
        end
    end
    TriggerClientEvent('rpchat:suggestions', player, suggestions)
end)

AddEventHandler('playerDropped', function()
    lastMessage[source] = nil
    lastReport[source] = nil
    lastSuggestionRequest[source] = nil
end)
