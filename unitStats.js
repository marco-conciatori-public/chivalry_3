// Base stats for all unit types
module.exports = {
    light_infantry: {
        attack: 20,
        defence: 10,
        has_shield: true,
        shield_bonus: 10, // Weak shield
        special_abilities: [],
        charge_bonus: 10,
        speed: 3,
        initial_morale: 50,
        is_commander: false,
        is_ranged: false,
        accuracy: 0,
        is_melee_capable: true,
        range: 1,
        max_health: 100,
        cost: 50
    },
    heavy_infantry: {
        attack: 30,
        defence: 50,
        has_shield: true,
        shield_bonus: 25, // Strong shield
        special_abilities: [],
        charge_bonus: 10,
        speed: 2,
        initial_morale: 90,
        is_commander: false,
        is_ranged: false,
        accuracy: 0,
        is_melee_capable: true,
        range: 1,
        max_health: 100,
        cost: 120
    },
    archer: {
        attack: 25, // Ranged attack
        defence: 5,
        has_shield: false,
        shield_bonus: 0,
        special_abilities: [],
        charge_bonus: 0,
        speed: 3,
        initial_morale: 40,
        is_commander: false,
        is_ranged: true,
        accuracy: 80,
        is_melee_capable: false, // Lose to everyone in melee (uses 50% damage penalty usually or just low stats)
        range: 6,
        max_health: 100,
        cost: 70
    },
    light_cavalry: {
        attack: 25,
        defence: 10,
        has_shield: true,
        shield_bonus: 10, // Weak shield
        special_abilities: [],
        charge_bonus: 20,
        speed: 5,
        initial_morale: 45,
        is_commander: false,
        is_ranged: false,
        accuracy: 0,
        is_melee_capable: true,
        range: 1,
        max_health: 50,
        cost: 90
    },
    heavy_cavalry: {
        attack: 40,
        defence: 45,
        has_shield: true,
        shield_bonus: 15, // Medium shield
        special_abilities: [],
        charge_bonus: 30,
        speed: 4,
        initial_morale: 90,
        is_commander: false,
        is_ranged: false,
        accuracy: 0,
        is_melee_capable: true,
        range: 1,
        max_health: 50,
        cost: 200
    },
    spearman: {
        attack: 25,
        defence: 20,
        has_shield: true,
        shield_bonus: 15, // Medium shield
        special_abilities: ['anti_cavalry'],
        charge_bonus: 10,
        speed: 3,
        initial_morale: 60,
        is_commander: false,
        is_ranged: false,
        accuracy: 0,
        is_melee_capable: true,
        range: 1,
        max_health: 100,
        cost: 80
    },
    catapult: {
        attack: 60,
        defence: 5,
        has_shield: false,
        shield_bonus: 0,
        special_abilities: [],
        charge_bonus: 0,
        speed: 1,
        initial_morale: 40,
        is_commander: false,
        is_ranged: true,
        accuracy: 60,
        is_melee_capable: false,
        range: 9,
        max_health: 50,
        cost: 300
    }
};