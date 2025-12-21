module.exports = {
    // Game Grid
    GRID_SIZE: 10,

    // Player Configuration
    PLAYER_COLORS: ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6'],
    STARTING_GOLD: 2000,

    // Combat Mechanics
    BONUS_DAMAGE: 20,
    BONUS_SHIELD: 20,
    // missing health cannot reduce attack damage below 20%
    MIN_DAMAGE_REDUCTION_BY_HEALTH: 0.2,
    // defense cannot reduce incoming damage below 10%
    MAX_DAMAGE_REDUCTION_BY_DEFENSE: 0.1,

    // Random Damage Variance (0.8 to 1.2 = +/- 20%)
    DAMAGE_RANDOM_BASE: 0.8,
    DAMAGE_RANDOM_VARIANCE: 0.4,

    // Morale Mechanics
    MORALE_THRESHOLD: 30,
    MAX_MORALE: 100,
    COMMANDER_INFLUENCE_RANGE: 4
};