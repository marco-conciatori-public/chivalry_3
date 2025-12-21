// Base stats for all unit types
const unitStats = {
    knight: {
        attack: 70,
        bonus_vs: ['archer'],
        defence: 60,
        has_shield: true,
        speed: 2,
        max_morale: 90,
        is_commander: false,
        is_ranged: false,
        accuracy: 0,
        is_melee_capable: true,
        range: 1,
        max_health: 100,
        cost: 100
    },
    archer: {
        attack: 45,
        bonus_vs: ['scout'],
        defence: 20,
        has_shield: false,
        speed: 2,
        max_morale: 60,
        is_commander: false,
        is_ranged: true,
        accuracy: 80,
        is_melee_capable: false,
        range: 3,
        max_health: 50,
        cost: 80
    },
    wizard: {
        attack: 85,
        bonus_vs: ['knight'],
        defence: 10,
        has_shield: false,
        speed: 1,
        max_morale: 40,
        is_commander: false,
        is_ranged: true,
        accuracy: 100,
        is_melee_capable: false,
        range: 2,
        max_health: 40,
        cost: 120
    },
    scout: {
        attack: 30,
        bonus_vs: ['wizard'],
        defence: 30,
        has_shield: false,
        speed: 3,
        max_morale: 50,
        is_commander: false,
        is_ranged: false,
        accuracy: 0,
        is_melee_capable: true,
        range: 1,
        max_health: 60,
        cost: 60
    }
};

const GAME_CONSTANTS = {
    BONUS_DAMAGE: 20,
    BONUS_SHIELD: 20
};

module.exports = { unitStats, GAME_CONSTANTS };